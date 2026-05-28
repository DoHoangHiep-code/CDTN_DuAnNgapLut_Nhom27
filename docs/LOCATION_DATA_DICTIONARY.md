# Location Data Dictionary — AQUAALERT

## 1. Nguyên tắc lưu trữ Location (3NF)

Dữ liệu địa danh (`location_name`) **chỉ được lưu trữ tại** bảng `grid_nodes`.

| Bảng | Có cột `location_name`? | Cách lấy tên địa danh |
|------|------------------------|------------------------|
| `grid_nodes` | ✅ Có — nguồn duy nhất | Trực tiếp |
| `weather_stations` | ✅ Có — đồng bộ khi geocode | Trực tiếp |
| `actual_flood_reports` | ✅ Có — ghi lúc user submit | Trực tiếp |
| `weather_measurements` | ❌ Đã drop | `JOIN grid_nodes ON node_id` |
| `flood_predictions` | ❌ Đã drop | `JOIN grid_nodes ON node_id` |

**Lý do**: Giảm dung lượng, tránh lỗi NULL khi cron chưa kịp sync, và đảm bảo khi cập nhật hành chính chỉ cần sửa 1 bảng.

## 2. Format chuẩn `location_name`

Chuỗi `location_name` tuân theo format 3 cấp:

```
[Đường/Phố/Ngõ], [Phường/Xã], [Quận/Huyện]
```

**Ví dụ:**
- `"Đường Vân Nội, Xã Thư Lâm, Huyện Đông Anh"`
- `"Ngõ 25, Phường Yên Hòa, Quận Cầu Giấy"`
- `"Khu vực Xã Đại Mạch, Huyện Đông Anh"` (khi không có đường cụ thể)

### Bóc tách từ Nominatim API

| Trường Nominatim | Ý nghĩa | Vị trí trong format |
|-------------------|----------|---------------------|
| `road`, `pedestrian`, `footway` | Đường/Phố/Ngõ | Phần 1 |
| `quarter`, `suburb`, `village` | Phường/Xã | Phần 2 |
| `city_district`, `county` | Quận/Huyện | Phần 3 |

## 3. Cách truy vấn dữ liệu theo Location

### Lấy dữ liệu thời tiết của 1 xã:
```sql
SELECT wm.*
FROM weather_measurements wm
JOIN grid_nodes gn ON wm.node_id = gn.node_id
WHERE gn.location_name ILIKE '%Xã Đông Anh%';
```

### Lấy dự báo ngập của 1 xã:
```sql
SELECT fp.*
FROM flood_predictions fp
JOIN grid_nodes gn ON fp.node_id = gn.node_id
WHERE gn.location_name = 'Khu vực Xã Đại Mạch, Huyện Đông Anh';
```

## 4. Quy trình cập nhật địa danh khi có thay đổi hành chính

Khi địa giới hành chính thay đổi (ví dụ: sáp nhập xã, đổi tên đường):

1. **Reset tên cũ** (nếu cần cập nhật toàn bộ):
   ```sql
   UPDATE grid_nodes SET location_name = NULL;
   ```

2. **Chạy script geocode**:
   ```bash
   cd backend
   node init-system/03_scripts/geocode_location_names.js
   ```
   - Thời gian ước tính: ~40 phút (2000 ô × 1.2s delay Nominatim).
   - Script tự động batch update DB mỗi 200 ô.

3. **Refresh Materialized Views** (nếu dùng MV có join location):
   ```sql
   REFRESH MATERIALIZED VIEW CONCURRENTLY mv_latest_flood_predictions;
   ```

4. **Clear Dashboard cache**: Restart backend hoặc đợi cache TTL hết hạn (60s–300s).
