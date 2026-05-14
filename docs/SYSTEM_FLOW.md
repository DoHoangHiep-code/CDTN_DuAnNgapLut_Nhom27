# SYSTEM_FLOW.md – Luồng hoạt động Hệ thống AQUAALERT

> **Cập nhật:** Tháng 5/2026 | **Backend:** Node.js + CockroachDB | **AI:** FastAPI + CatBoost
> **Rolling Window:** 72h tương lai + 48h quá khứ (5 ngày tổng)

---

## 1. Kiến trúc tổng quan

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AQUAALERT BACKEND                            │
│                                                                     │
│  ┌──────────────┐    ┌─────────────────┐    ┌───────────────────┐  │
│  │  weatherCron │───▶│  OpenWeatherMap  │    │   Frontend (React) │  │
│  │  (Node-cron) │    │   API (OWM)      │    │   MapPage, Dashboard│  │
│  └──────┬───────┘    └─────────────────┘    └────────┬──────────┘  │
│         │                                            │              │
│         ▼                                            ▼              │
│  ┌──────────────┐    ┌─────────────────┐    ┌───────────────────┐  │
│  │  AI Service  │    │  CockroachDB    │    │  Express REST API  │  │
│  │  (FastAPI:   │◀──▶│  (PostgreSQL)   │◀───│  /api/v1/...      │  │
│  │   port 8000) │    │                 │    └───────────────────┘  │
│  └──────────────┘    └─────────────────┘                           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Cấu trúc Database (7 bảng + 3 Materialized Views)

```
weather_stations (88 rows) ──────────────────────────────┐
  id, name, latitude, longitude, node_count, grid_row, grid_col │
                                                          │
grid_nodes (53.330 rows) ◄───────────────────────────────┘
  node_id (PK)                weather_station_id → weather_stations.id
  latitude, longitude         st1_id / st1_weight  (IDW top-1)
  elevation, slope            st2_id / st2_weight  (IDW top-2)
  impervious_ratio            st3_id / st3_weight  (IDW top-3)
  location_name               district_name
  dist_to_drain_km            dist_to_river_km
  dist_to_pump_km             dist_to_main_road_km
  geom (PostGIS Point)

       │                                │
       ▼                                ▼
weather_measurements              flood_predictions
  (88 rows/cron × 96h              (53.330 nodes × 96h
   = ~8.536 rows rolling)           = ~315K rows rolling)
  node_id → grid_nodes (FK)         node_id → grid_nodes (FK)
  time (UTC)                         time (UTC)
  temp, rhum, prcp, ...              flood_depth_cm
  location_name                      risk_level (safe/medium/high/severe)
                                     explanation (text)
                                     location_name

users (4 rows)
  user_id, username, email, password_hash, role

actual_flood_reports            system_logs
  user_id → users (FK)          admin_id → users (FK)
  geom (PostGIS Point)          event_type, message, timestamp
  flood_depth_cm, image_url

──── Materialized Views ────
mv_latest_flood_predictions    → Dự báo mới nhất của mỗi node
mv_global_flood_avg            → Trung bình độ ngập theo thời gian
mv_global_risk_trend           → Xu hướng risk level theo giờ
```

---

## 3. Luồng dữ liệu chính: WeatherCron

**Trigger:** Mỗi 1 tiếng (`0 * * * *` theo giờ Việt Nam)

```
╔══════════════════════════════════════════════════════════════════╗
║  PHASE 0 – Lấy thời tiết HIỆN TẠI (1 snapshot/trạm)            ║
╚══════════════════════════════════════════════════════════════════╝

OWM /data/2.5/weather
  → GET lat=trạm1.lat&lon=trạm1.lon  ─┐
  → GET lat=trạm2.lat&lon=trạm2.lon  ─┤ 88 calls song song
  → ...                               ─┤
  → GET lat=trạm88.lat&lon=trạm88.lon ─┘

Mỗi response trả về:
  {temp, humidity, rain_1h, windSpeed, windDeg, pressure, clouds, visibility}

→ Ghi vào weather_measurements:
  88 rows (1 row/trạm, dùng node đại diện của trạm làm node_id)
  ⚠️  KHÔNG nhân bản ra 53.330 nodes

╔══════════════════════════════════════════════════════════════════╗
║  PHASE 1 – Lấy dự báo 72h (hourly forecast, slice 72 điểm)      ║
╚══════════════════════════════════════════════════════════════════╝

OWM /data/2.5/forecast/hourly (hoặc /data/2.5/forecast 5d/3h)
  → GET lat=trạm1.lat&lon=trạm1.lon  ─┐
  → ...                               ─┤ 88 calls (10 trạm/batch, delay 1s)
  → GET lat=trạm88.lat&lon=trạm88.lon ─┘

Mỗi response trả về raw 96h, slice về 72 điểm × 1h (FORECAST_HOURS=72)
  Mỗi điểm: {timeUtc, temp, humidity, rain3h, windSpeed, pressure, clouds, ...}

→ Lưu vào RAM: stationForecasts Map<stationId → owmPoints[]>

╔══════════════════════════════════════════════════════════════════╗
║  PHASE 1.5 – Ghi weather_measurements (forecast 96h)            ║
╚══════════════════════════════════════════════════════════════════╝

Với mỗi trạm × 96 điểm:
  → Lấy node đại diện (node đầu tiên của cluster)
  → Tạo 1 weather_measurements row per timepoint
  → Tổng: 88 trạm × 72h = 6.336 rows
  → UPSERT (ON CONFLICT node_id, time → UPDATE)

╔══════════════════════════════════════════════════════════════════╗
║  PHASE 2 – AI Inference: Tính flood_depth_cm cho 53K nodes      ║
╚══════════════════════════════════════════════════════════════════╝

Với mỗi trạm (xử lý tuần tự, 1 trạm/lần để tránh OOM):

  1. Lấy tất cả grid_nodes có weather_station_id = trạm này
     (VD: trạm VS_R2_C3 có 612 nodes)

  2. buildSharedWeatherFeatures(owmPoints):
     Tính 1 lần cho tất cả 96 timepoints của trạm:
     {prcp, prcp_3h, prcp_6h, prcp_12h, prcp_24h,
      temp, rhum, wspd, pres, pressure_change_24h,
      hour, month, dayofweek, rainy_season_flag, ...}

  3. Tạo mega feature matrix:
     612 nodes × 96 timepoints = 58.752 feature vectors
     Mỗi vector merge: sharedWeather + node.elevation + node.slope + node.impervious_ratio

  4. Gọi FastAPI /api/predict/batch (batch 500 vectors/lần):
     POST http://localhost:8000/api/predict/batch
     Body: [{prcp, temp, elevation, ...}, ...]
     Response: [{flood_depth_cm: 12.3}, ...]

  5. Map kết quả: flood_depth_cm → risk_level + explanation
     risk_level:
       < 15cm  → 'safe'
       < 30cm  → 'medium'
       < 60cm  → 'high'
       ≥ 60cm  → 'severe'

  6. UPSERT flood_predictions (batch 12.000 rows/lần):
     43.200 rows mỗi trạm trung bình × 88 trạm ≈ ~3.8M rows/lần chạy đầy đủ
     Thực tế: flush mỗi 200.000 records để tránh timeout

╔══════════════════════════════════════════════════════════════════╗
║  CLEANUP – Dọn dẹp data cũ (01:00 AM hàng ngày)                 ║
╚══════════════════════════════════════════════════════════════════╝

DELETE FROM flood_predictions WHERE time < NOW() - INTERVAL '2 days'
DELETE FROM weather_measurements WHERE time < NOW() - INTERVAL '2 days'
→ Giữ rolling window 5 ngày (48h quá khứ + 72h tương lai)
```

---

## 4. Dữ liệu từ OWM API gồm những gì?

### 4.1 Current Weather (`/data/2.5/weather`)
```json
{
  "temp": 28.5,           // °C
  "feels_like": 32.1,     // °C
  "humidity": 78,         // %
  "pressure": 1010,       // hPa
  "wind_speed": 3.2,      // m/s
  "wind_deg": 180,        // °
  "clouds": 75,           // %
  "visibility": 8000,     // m
  "rain.1h": 2.5          // mm (mưa trong 1h qua)
}
```

### 4.2 Forecast (`/data/2.5/forecast` hoặc `/forecast/hourly`)
```json
{
  "list": [
    {
      "dt": 1747094400,        // Unix timestamp
      "main": { "temp", "humidity", "pressure", "feels_like" },
      "wind": { "speed", "deg" },
      "clouds": { "all" },     // % mây che phủ
      "rain": { "3h": 0.5 },   // mm mưa trong 3h
      "visibility": 10000
    },
    ... // 40 points × 3h = 5 ngày
  ]
}
```

### 4.3 Mapping sang DB
| OWM field | DB field | Đơn vị |
|-----------|----------|-------|
| `main.temp` | `temp` | °C |
| `main.humidity` | `rhum` | % |
| `main.pressure` | `pres` | hPa |
| `main.feels_like` | `feels_like_c` | °C |
| `wind.speed` | `wspd` | m/s |
| `wind.deg` | `wdir` | ° |
| `clouds.all` | `clouds` | % |
| `rain.3h` | `prcp`, `prcp_3h` | mm |
| `visibility` / 1000 | `visibility_km` | km |

---

## 5. AI Model: Cách tính flood_depth_cm

### 5.1 Input features (mỗi vector)
| Feature | Nguồn |
|---------|-------|
| `prcp`, `prcp_3h`, `prcp_6h`, `prcp_12h`, `prcp_24h` | Sliding window OWM |
| `temp`, `rhum`, `wspd`, `pres` | OWM forecast point |
| `pressure_change_24h` | Δ pres so với 24h trước |
| `max_prcp_3h`, `max_prcp_6h`, `max_prcp_12h` | = prcp_Xh |
| `elevation` | grid_nodes.elevation |
| `slope` | grid_nodes.slope |
| `impervious_ratio` | grid_nodes.impervious_ratio |
| `dist_to_drain_km` | grid_nodes (default 0.5) |
| `dist_to_river_km` | grid_nodes (default 1.0) |
| `dist_to_pump_km` | grid_nodes (default 1.0) |
| `dist_to_main_road_km` | grid_nodes (default 0.3) |
| `dist_to_park_km` | grid_nodes (default 0.5) |
| `hour`, `month`, `dayofweek`, `dayofyear` | Thời gian |
| `hour_sin`, `hour_cos` | sin/cos(2π×hour/24) |
| `month_sin`, `month_cos` | sin/cos(2π×month/12) |
| `rainy_season_flag` | 1 nếu tháng 5-10, else 0 |

### 5.2 Output
```json
{ "flood_depth_cm": 12.3 }
```

---

## 6. API Routes chính (Frontend ↔ Backend)

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/api/v1/nodes/flood-map` | Toàn bộ nodes + flood_depth hiện tại (map heatmap) |
| GET | `/api/v1/nodes/:id/current` | Chi tiết 1 node + dự báo + thời tiết |
| GET | `/api/v1/predictions/latest` | Latest predictions (dùng MV) |
| GET | `/api/v1/predictions/stats` | Thống kê theo ngày/quận |
| GET | `/api/v1/weather/stations` | Danh sách 88 trạm |
| POST | `/api/v1/weather/trigger-cron` | Trigger manual cronjob |
| GET | `/api/v1/dashboard/summary` | Dashboard tổng quan |
| GET | `/api/v1/reports/hotspots` | 39 điểm ngập hotspot |

---

## 7. Vòng đời dữ liệu (Data Lifecycle)

```
T=0h    Cron chạy
  ├── Phase 0: 88 OWM calls → 88 rows weather_measurements (snapshot hiện tại)
  ├── Phase 1: 88 OWM calls → forecast 72h/trạm lưu RAM (slice 72 điểm đầu)
  ├── Phase 1.5: 88×72 = 6.336 rows → weather_measurements (UPSERT)
  └── Phase 2: 53.330 nodes × 72h → AI → flood_predictions (UPSERT ~3.8M rows)

T=7 ngày  Cleanup cron (01:00 AM)
  └── DELETE weather_measurements + flood_predictions WHERE time < NOW()-7d

T=∞     Rolling window 7 ngày luôn có data
```

---

## 8. Tài khoản & Phân quyền

| Username | Role | Mật khẩu | Quyền |
|----------|------|----------|-------|
| `admin` | admin | `Admin@2026!` | Toàn quyền |
| `analyst1` | expert | `Analyst@2026!` | Xem + phân tích |
| `analyst2` | expert | `Analyst@2026!` | Xem + phân tích |
| `analyst3` | expert | `Analyst@2026!` | Xem + phân tích |

---

## 9. Scripts vận hành

| Lệnh | Mục đích | Khi nào chạy |
|------|---------|-------------|
| `node scripts/setup_virtual_stations.js` | Tái tạo 88 trạm ảo + map 53K nodes | Sau khi reset DB hoặc đổi lưới |
| `node scripts/calc_idw_weights.js` | Tính IDW weights (st1/st2/st3) | Sau setup_virtual_stations |
| `node scripts/geocode_location_names.js` | Đặt tên Phường/Xã (~60 phút) | Sau setup xong |
| `node fix_location_sync.js` | Sync location_name + district_name | Sau geocode xong |
| `node scripts/seed_users.js` | Tạo tài khoản mẫu | Khi DB mới |
| `node scripts/seed_hotspots.js` | Tạo 39 điểm ngập nổi tiếng | Khi DB mới |
| `node fast_delete.js` | Xóa data cũ theo ngày | Khi cần reset data |
| `node refresh_mvs.js` | Refresh Materialized Views | Sau khi cron ghi xong |
| `node audit_db.js` | Kiểm tra toàn bộ DB state | Khi debug |

---

## 10. Chẩn đoán nhanh (Quick Diagnosis)

```bash
# Kiểm tra data có thật không
node audit_db.js

# Bao nhiêu rows và date range?
# → weather_measurements: distinct_times >= 97, distinct_nodes = 88 → DATA THẬT ✅
# → location_name = 'Grid_*' → Cần chạy fix_location_sync.js ❌

# Cron có đang chạy không?
# → Xem console log backend, hoặc:
curl -X POST http://localhost:3002/api/v1/weather/trigger-cron

# AI service có up không?
curl http://localhost:8000/health
```

---

*Tài liệu liên quan: `docs/STATION_LOGIC.md` (lưới 3×3km), `docs/DATABASE_SCHEMA.md` (chi tiết bảng & FK)*
