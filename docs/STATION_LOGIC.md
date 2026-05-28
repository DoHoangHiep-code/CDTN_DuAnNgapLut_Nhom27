# STATION_LOGIC.md – Tài liệu kỹ thuật Mạng lưới Trạm Ảo AQUAALERT

> **Cập nhật lần cuối:** Tháng 5/2026  
> **Phiên bản:** v3 (3×3km Virtual Station Grid + IDW Weights)

---

## 1. Tổng quan kiến trúc

AQUAALERT sử dụng mô hình **"Trạm Thời Tiết Ảo"** (Virtual Weather Station) để tối ưu số lần gọi API thời tiết, đồng thời vẫn đảm bảo độ chính xác dự báo cho toàn bộ ~53.000 điểm lưới (grid nodes) trên địa bàn Hà Nội.

```
OpenWeatherMap API
      │  (88 calls/lần)
      ▼
weather_stations (88 trạm ảo)        ◄── Fetch 1 lần/trạm
      │
      │  JOIN qua weather_station_id
      ▼
grid_nodes (53.330 nodes)            ◄── Không fetch riêng từng node
      │
      │  AI Inference (CatBoost)
      ▼
flood_predictions (53.330 × N giờ dự báo)
```

**Nguyên tắc cốt lõi:**
- Cronjob chỉ gọi API cho **88 trạm** → lưu **88 rows** vào `weather_measurements`
- Tuyệt đối **KHÔNG fan-out** (nhân bản) data thời tiết ra 53.000 node
- Mỗi `grid_node` có các trường `st1_id`, `st2_id`, `st3_id` để trỏ đến các trạm ảo lân cận.
- **Point-to-Station Mapping:** Khi hệ thống (hoặc Frontend) yêu cầu dữ liệu thời tiết cho một vị trí tọa độ cụ thể (Node), Backend sẽ truy vấn bảng `grid_nodes` để tìm `st1_id` gần nhất, sau đó dùng `st1_id` này để tra cứu dữ liệu 72h trong bảng `weather_measurements`. Tuyệt đối không gọi live API từ OWM khi cache không có hoặc quá hạn, nhằm tránh sập rate-limit và làm phình hệ thống.

---

## 2. Nguyên lý chia lưới 3km × 3km

### 2.1 Tính Bounding Box

Script đọc toàn bộ `grid_nodes` từ DB, tự động tính:

```
minLat = MIN(latitude)    # ~20.8629°
maxLat = MAX(latitude)    # ~21.1725°
minLon = MIN(longitude)   # ~105.6242°
maxLon = MAX(longitude)   # ~105.9385°
```

Sau đó mở rộng thêm **margin = 0.5 ô** về mỗi phía để không bỏ sót các node ở rìa.

### 2.2 Chuyển đổi km → độ

Tại vĩ độ Hà Nội (≈21°):

```
GRID_DEG_LAT = 3 / 111.0                           ≈ 0.02703°/km (lat)
GRID_DEG_LON = 3 / (111.0 × cos(21° × π/180))     ≈ 0.02894°/km (lon)
```

### 2.3 Sinh lưới ô vuông

```
nRows = ceil((maxLat - minLat) / GRID_DEG_LAT)   ≈ 13 hàng
nCols = ceil((maxLon - minLon) / GRID_DEG_LON)   ≈ 12 cột
Tổng ô tiềm năng: 13 × 12 = 156 ô
```

Tâm của mỗi ô `(r, c)`:
```
centLat = minLat + (r + 0.5) × GRID_DEG_LAT
centLon = minLon + (c + 0.5) × GRID_DEG_LON
```

---

## 3. Thuật toán Mapping Node → Trạm (Haversine)

### 3.1 Công thức Haversine

Để tính khoảng cách chính xác (km) giữa hai tọa độ:

```javascript
function haversineKm(lat1, lon1, lat2, lon2) {
  const R    = 6371                              // bán kính Trái Đất (km)
  const dLat = (lat2 - lat1) × π / 180
  const dLon = (lon2 - lon1) × π / 180
  const a    = sin(dLat/2)² + cos(lat1×π/180) × cos(lat2×π/180) × sin(dLon/2)²
  return R × 2 × atan2(√a, √(1-a))
}
```

### 3.2 Thuật toán lookup O(N)

Thay vì brute-force O(N×M), script dùng **grid-cell lookup**:
1. Mỗi node → ước tính ô lưới `(rEst, cEst)` bằng phép chia đơn giản
2. Tìm trạm gần nhất trong **9 ô lân cận** (3×3 quanh ô ước tính)
3. Nếu không tìm thấy → fallback brute-force toàn bộ (node ngoài margin)

---

## 4. Bộ lọc Trạm Rỗng (Orphan Filter)

Địa giới Hà Nội **không phải hình chữ nhật** → nhiều ô lưới rìa không chứa node nào.

**Quy tắc bắt buộc:**
- Chỉ INSERT vào `weather_stations` những trạm có `node_count > 0`
- Trạm `node_count === 0` bị loại **ngay trên RAM**, không lưu xuống DB

**Kết quả thực tế:**
```
Tổng ô lưới tiềm năng:  156
Trạm hợp lệ (node_count > 0):  88   ← CHỈ CÁI NÀY ĐƯỢC LƯU
Trạm rỗng bị loại:      68
```

**Lệnh SQL dọn dẹp thủ công (chạy sau nếu cần):**
```sql
DELETE FROM weather_stations WHERE node_count = 0;
```

---

## 5. Quy trình thay đổi API thời tiết (Step-by-step)

Khi bạn đổi nhà cung cấp API (ví dụ từ OWM sang OpenMeteo), thực hiện theo thứ tự:

### Bước 1 – Cập nhật credentials trong `.env`
```env
OPENWEATHER_API_KEY=<YOUR_NEW_API_KEY>
```

### Bước 2 – Cập nhật hàm fetch trong `OpenWeatherService.js`
File: `backend/src/services/OpenWeatherService.js`
- Sửa URL endpoint, params, và cách parse response
- Đảm bảo hàm `getWeatherByCoords(lat, lon)` trả về object chuẩn:
```javascript
{
  temp,        // °C
  humidity,    // %
  rain1h,      // mm (mưa 1h gần nhất)
  windSpeed,   // m/s
  windDeg,     // °
  pressure,    // hPa
  clouds,      // %
  visibility,  // m (optional)
  feels_like   // °C (optional)
}
```

### Bước 3 – KHÔNG cần chạy lại setup_virtual_stations.js
Chỉ cần chạy lại nếu bạn muốn **thay đổi kích thước lưới** (ví dụ 5km×5km thay vì 3km×3km).

### Bước 4 – Khởi động lại backend
```bash
cd backend && npm start
```

Backend sẽ tự trigger `WeatherCron` vào giờ chẵn tiếp theo. Để test ngay:
```bash
curl -X POST http://localhost:3002/api/v1/weather/trigger-cron
```

---

## 6. Chạy lại toàn bộ mạng lưới trạm từ đầu

> Dùng khi: thay đổi kích thước ô lưới, thêm nodes mới, hoặc DB bị corrupt.

```bash
# Bước 1: Import lại 53K grid nodes (nếu cần)
node scripts/import_grid_features.js

# Bước 2: Tạo lại toàn bộ trạm ảo + mapping
node scripts/setup_virtual_stations.js

# Bước 3: Khởi động lại backend
npm start
```

Log thành công:
```
✅ HOÀN THÀNH
   Đã tạo 88 trạm ảo hợp lệ. Đã map thành công cho 53330 nodes.
   Trạm rỗng đã lọc: 68
```

---

## 7. Thống kê phân bố trạm (tháng 5/2026)

| Vùng | Số trạm | Ghi chú |
|------|---------|---------|
| Toàn bộ hợp lệ | **88** | Sau khi lọc orphan |
| Rỗng (bị loại) | 68 | Ngoài ranh giới Hà Nội |
| Tổng ô lưới tính | 156 | 13 hàng × 12 cột |

---

## 8. Công thức Trọng số IDW (Inverse Distance Weighting)

### 8.1 Mục đích

Mỗi `grid_node` có 3 trường ID trạm (`st1_id`, `st2_id`, `st3_id`) và 3 trọng số tương ứng (`st1_weight`, `st2_weight`, `st3_weight`) để nội suy dữ liệu thời tiết chính xác hơn cho điểm lưới đó.

### 8.2 Công thức

**Bước 1:** Tính khoảng cách Haversine từ node đến 3 trạm gần nhất:
```
d1, d2, d3  (km)
```

**Bước 2:** Tính trọng số thô (nghịch đảo bình phương khoảng cách):
```
w_i(raw) = 1 / d_i²
```

**Bước 3:** Chuẩn hóa để tổng bằng 1:
```
Weight_i = w_i(raw) / (w1 + w2 + w3)

⇒ Weight_1 + Weight_2 + Weight_3 = 1.0
```

**Ý nghĩa:** Node gần trạm nào hơn thì trạm đó có ảnh hưởng lớn hơn (Weight cao hơn).

### 8.3 Ví dụ nội suy nhiệt độ

```javascript
// Node có st1_id=5 (1.2km, weight=0.72), st2_id=12 (2.1km, weight=0.19), st3_id=7 (3.5km, weight=0.09)
const temp = station[5].temp * 0.72 + station[12].temp * 0.19 + station[7].temp * 0.09
```

### 8.4 Chạy lại IDW

```bash
# Chạy lại khi thêm/xóa trạm hoặc thay đổi lưới
node scripts/calc_idw_weights.js
```

Thời gian: ~2s tính RAM + ~46s ghi DB (53K nodes × batch 500).

---

## 9. Chiến lược Geocoding location_name (Cell Grid)

Thay vì gọi Nominatim 53.000 lần (quá chậm + bị rate-limit), hệ thống dùng chiến lược **ô lưới**:

1. Chia bản đồ Hà Nội thành các ô **~0.44km × 0.44km** (~3.000 ô)
2. Gọi Nominatim **1 lần cho tâm mỗi ô** (tổng ~3.000 API calls)
3. Tất cả nodes trong ô đƳợc gán cùng tên địa danh
4. Delay **1.2s** giữa mỗi call để tuân thủ Nominatim rate limit

**Kết quả:** Giảm 95% lượng API calls, thời gian chạy ~60 phút (chạy nghiềm/offline, không ảnh hưởng user).

```bash
# Chạy geocoding (có thể dừng và chạy lại bất cứ lúc nào, idempotent)
node scripts/geocode_location_names.js
```

---

*Mọi thắc mắc về kiến trúc, liên hệ team Backend AQUAALERT.*
