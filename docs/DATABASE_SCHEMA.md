# DATABASE_SCHEMA.md – Kiến trúc Cơ sở Dữ liệu AQUAALERT

> **Cập nhật lần cuối:** Tháng 5/2026  
> **DB:** CockroachDB (PostgreSQL-compatible)

---

## 1. Sơ đồ quan hệ bảng (ERD)

```
users
  └─ user_id (PK)
       ├── actual_flood_reports.user_id (FK)
       └── system_logs.admin_id (FK)

weather_stations
  └─ id (PK)
       └── grid_nodes.weather_station_id (FK, soft – no constraint)
           grid_nodes.st1_id / st2_id / st3_id (IDW refs, float)

grid_nodes
  └─ node_id (PK)
       ├── weather_measurements.node_id (FK)
       └── flood_predictions.node_id (FK)
```

**Luồng dữ liệu:**
```
OWM API → weather_stations (88 trạm)
        → weather_measurements (88 rows/cron)  ──→ node_id = repNode của trạm
        
AI Model → flood_predictions (53K rows/cron)  ──→ node_id = từng grid_node
```

---

## 2. Chi tiết từng bảng

### 2.1 `grid_nodes` – Điểm lưới dự báo
| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `node_id` | BIGINT PK | ID điểm lưới (1–53330 = CSV; 200001–200039 = hotspot) |
| `latitude` | DECIMAL(9,6) | Vĩ độ |
| `longitude` | DECIMAL(9,6) | Kinh độ |
| `elevation` | DECIMAL | Độ cao so với mực nước biển (m) |
| `slope` | DECIMAL | Độ dốc địa hình |
| `impervious_ratio` | DECIMAL | Tỷ lệ không thấm nước (0–1) |
| `geom` | GEOMETRY(POINT,4326) | PostGIS point, dùng cho spatial query |
| `dist_to_drain_km` | DECIMAL | Khoảng cách đến cống thoát nước (km) |
| `dist_to_river_km` | DECIMAL | Khoảng cách đến sông (km) |
| `dist_to_pump_km` | DECIMAL | Khoảng cách đến trạm bơm (km) |
| `dist_to_main_road_km` | DECIMAL | Khoảng cách đến đường chính (km) |
| `dist_to_park_km` | DECIMAL | Khoảng cách đến công viên (km) |
| `location_name` | VARCHAR(512) | Tên địa danh (Phường/Xã, Quận) |
| `district_name` | VARCHAR | Phần sau dấu phẩy của location_name (tên quận) |
| `grid_id` | VARCHAR(64) | ID gốc từ CSV (Grid_0, Grid_1...) |
| `weather_station_id` | INTEGER | Trạm đại diện (FK soft → weather_stations.id) |
| `st1_id/weight` | FLOAT | IDW: Trạm gần nhất + trọng số |
| `st2_id/weight` | FLOAT | IDW: Trạm gần nhì + trọng số |
| `st3_id/weight` | FLOAT | IDW: Trạm gần ba + trọng số |
| `is_out_of_bounds` | BOOLEAN | true nếu node ngoài vùng lưới |

> **Lưu ý `district_name`:** Không phải FK, được tính tự động từ `location_name` bằng `SPLIT_PART(location_name, ',', 2)`.  
> Chạy `node fix_location_sync.js` để re-sync nếu cần.

### 2.2 `weather_stations` – Trạm thời tiết ảo
| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `id` | INT PK | ID trạm |
| `name` | VARCHAR(128) | Tên trạm (VD: VS_R2_C3) |
| `latitude` | DECIMAL(9,6) | Tọa độ tâm ô lưới 3km |
| `longitude` | DECIMAL(9,6) | Tọa độ tâm ô lưới 3km |
| `node_count` | INTEGER | Số grid_nodes trong ô lưới |
| `grid_row` | INTEGER | Hàng trong lưới 13×12 |
| `grid_col` | INTEGER | Cột trong lưới 13×12 |

> **88 trạm** = sau lọc orphan (node_count > 0). Lưới gốc 13×12=156 ô, 68 ô rỗng bị loại.

### 2.3 `weather_measurements` – Dữ liệu thời tiết
| Cột | Mô tả |
|-----|-------|
| `measurement_id` | PK |
| `node_id` | FK → grid_nodes (1 node đại diện/trạm) |
| `time` | Timestamp UTC |
| `location_name` | Sync từ grid_nodes.location_name |
| `temp, rhum, prcp, ...` | Các thông số thời tiết từ OWM |

> ⚠️ **KIẾN TRÚC ĐÚNG:** Mỗi lần cron chỉ insert **88 rows** (1/trạm), **KHÔNG** fan-out ra 53K nodes.  
> `location_name` ở đây phải khớp với `grid_nodes.location_name` — dùng `fix_location_sync.js` để đồng bộ.

### 2.4 `flood_predictions` – Dự báo ngập lụt
| Cột | Mô tả |
|-----|-------|
| `prediction_id` | PK |
| `node_id` | FK → grid_nodes |
| `time` | Timestamp dự báo (UTC) |
| `flood_depth_cm` | Độ ngập dự báo (cm) |
| `risk_level` | low/medium/high/critical |
| `location_name` | Sync từ grid_nodes.location_name |
| `date_only, month, hour` | Partition helpers |

### 2.5 `users` – Tài khoản hệ thống
| Cột | Mô tả |
|-----|-------|
| `user_id` | PK |
| `username, email` | UNIQUE |
| `password_hash` | bcrypt (salt=12) |
| `role` | 'admin' \| 'expert' \| 'user' |

### 2.6 `actual_flood_reports` – Báo cáo ngập thực tế
| Cột | Mô tả |
|-----|-------|
| `user_id` | FK → users (người báo cáo) |
| `geom` | PostGIS point |

### 2.7 Materialized Views (MV)
| Tên | Mô tả |
|-----|-------|
| `mv_latest_flood_predictions` | Dự báo mới nhất mỗi node |
| `mv_global_flood_avg` | Trung bình ngập theo thời gian |
| `mv_global_risk_trend` | Xu hướng risk level |

> **Refresh MV:** Chạy `node refresh_mvs.js` sau khi cron ghi xong predictions.

---

## 3. Foreign Key Constraints

| Bảng nguồn | Cột | → | Bảng đích | Cột |
|------------|-----|---|-----------|-----|
| `weather_measurements` | `node_id` | → | `grid_nodes` | `node_id` |
| `flood_predictions` | `node_id` | → | `grid_nodes` | `node_id` |
| `actual_flood_reports` | `user_id` | → | `users` | `user_id` |
| `system_logs` | `admin_id` | → | `users` | `user_id` |

> **Lưu ý:** `grid_nodes.weather_station_id` và `grid_nodes.st1_id/st2_id/st3_id` là **soft reference** (không có FK constraint) → có thể NULL hoặc trỏ đến trạm đã xóa.

---

## 4. Quy trình đồng bộ dữ liệu (Data Sync Playbook)

### 4.1 Sau khi thay đổi cấu trúc DB / migrate
```bash
# 1. Chạy migration
node run_migrations.js

# 2. Tái tạo lưới trạm 88 ô
node scripts/setup_virtual_stations.js

# 3. Tính lại IDW weights
node scripts/calc_idw_weights.js

# 4. Geocoding location_name (chạy ngầm ~60 phút)
node scripts/geocode_location_names.js

# 5. Sync location_name + district_name sang các bảng con
node fix_location_sync.js
```

### 4.2 Sau khi geocoding hoàn tất
```bash
# Sync location_name mới nhất vào weather_measurements + flood_predictions
node fix_location_sync.js
```

### 4.3 Xóa data cũ / reset để chạy cron thật
```bash
# TRUNCATE weather_measurements + flood_predictions (KHÔNG xóa grid_nodes)
# Dùng khi muốn reset về trạng thái sạch trước khi cho cron chạy data thật
node fast_delete.js

# Sau đó trigger cron thủ công:
curl -X POST http://localhost:3002/api/v1/weather/trigger-cron
```

### 4.4 Kiểm tra data có phải thật không
| Dấu hiệu | Data thật | Data ảo/seed |
|----------|-----------|--------------|
| `distinct_times` trong weather_measurements | ≥ 97 (forecast 5d) | 1–5 |
| `location_name` trong weather_measurements | Tên Phường/Quận | `Grid_*` hoặc `VS_R*` |
| `distinct_nodes` | 88 | 1 hoặc số rất nhỏ |

---

## 5. Các lỗi thường gặp & cách xử lý

| Lỗi | Nguyên nhân | Cách fix |
|-----|-------------|----------|
| `location_name` = `Grid_*` trong wm/fp | Chưa sync sau geocoding | `node fix_location_sync.js` |
| `district_name` NULL | Chưa chạy fix hoặc geocoding chưa xong | `node fix_location_sync.js` |
| `st1_id` NULL | Chưa chạy IDW | `node scripts/calc_idw_weights.js` |
| `weather_station_id` NULL | Chưa setup virtual stations | `node scripts/setup_virtual_stations.js` |
| FK violation khi insert wm | node_id không tồn tại trong grid_nodes | Kiểm tra node đại diện trạm có trong grid_nodes |
| Cron ghi 0 rows | OWM API key hết quota | Kiểm tra `.env` OPENWEATHER_API_KEY |
| MV trả về data cũ | MV chưa refresh | `node refresh_mvs.js` |

---

*Tài liệu này được duy trì song song với `docs/STATION_LOGIC.md`. Cập nhật cả hai khi thay đổi kiến trúc.*
