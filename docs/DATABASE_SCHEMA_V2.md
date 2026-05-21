# AQUAALERT Database Schema V2 (3NF Normalized)

Tài liệu này mô tả cấu trúc cơ sở dữ liệu hiện tại (Version 2) của hệ thống AQUAALERT sau khi chuẩn hóa 3NF và tối ưu hóa Geocoding.

## Danh sách các bảng chính

### 1. Bảng `users`
Lưu trữ thông tin tài khoản đăng nhập của người quản trị và người dùng.

| Tên cột | Kiểu dữ liệu | Primary Key (PK) | Foreign Key (FK) | Ghi chú |
|---|---|---|---|---|
| `id` | `UUID` | Có | - | ID định danh người dùng (Tạo tự động). |
| `username` | `VARCHAR(50)` | - | - | Tên đăng nhập (Unique). |
| `password_hash` | `VARCHAR(255)` | - | - | Mật khẩu đã được mã hóa. |
| `role` | `VARCHAR(20)` | - | - | Quyền của user (VD: 'admin'). |
| `created_at` | `TIMESTAMPTZ` | - | - | Thời điểm tạo tài khoản. |

---

### 2. Bảng `grid_nodes` (Trung tâm định vị 3NF)
Đây là bảng cốt lõi chứa thông tin định vị địa lý chi tiết. Đóng vai trò là bảng tham chiếu duy nhất cho `location_name`.

| Tên cột | Kiểu dữ liệu | Primary Key (PK) | Foreign Key (FK) | Ghi chú |
|---|---|---|---|---|
| `node_id` | `VARCHAR(50)` | Có | - | ID ô lưới (Grid Node). |
| `latitude` | `DECIMAL(9,6)` | - | - | Vĩ độ của ô lưới. |
| `longitude` | `DECIMAL(9,6)` | - | - | Kinh độ của ô lưới. |
| `location_name` | `VARCHAR(255)` | - | - | Tên địa danh (Đường, Xã/Phường, Quận/Huyện). Chứa thông tin định vị sâu nhất. |
| `district_name` | `VARCHAR(100)` | - | - | Tên Quận/Huyện để phục vụ lọc và nhóm dữ liệu. |
| `st1_id` | `VARCHAR(50)` | - | - | ID trạm thời tiết ảo gần nhất (Dùng làm cầu nối lấy thời tiết cho node này). |
| `weather_station_id` | `VARCHAR(50)` | - | Trỏ đến `weather_stations.id` | Trạm thời tiết vật lý gần nhất (nếu có). |

---

### 3. Bảng `weather_stations`
Danh sách 88 trạm thời tiết (ảo) được phân bổ để làm đại diện đo lường thời tiết cho các grid nodes.

| Tên cột | Kiểu dữ liệu | Primary Key (PK) | Foreign Key (FK) | Ghi chú |
|---|---|---|---|---|
| `id` | `VARCHAR(50)` | Có | - | Mã trạm thời tiết (VD: 'ST_001'). |
| `latitude` | `DECIMAL(9,6)` | - | - | Vĩ độ của trạm. |
| `longitude` | `DECIMAL(9,6)` | - | - | Kinh độ của trạm. |
| `location_name` | `VARCHAR(255)` | - | - | Tên vị trí đặt trạm. |

---

### 4. Bảng `weather_measurements`
Chứa dữ liệu đo lường thời tiết theo thời gian thực (được tải về và cập nhật định kỳ mỗi giờ).

| Tên cột | Kiểu dữ liệu | Primary Key (PK) | Foreign Key (FK) | Ghi chú |
|---|---|---|---|---|
| `time` | `TIMESTAMPTZ` | Có | - | Thời điểm lấy mẫu thời tiết. |
| `node_id` | `VARCHAR(50)` | Có | Trỏ đến `weather_stations.id` | ID trạm lấy mẫu thời tiết. |
| `temp` | `DECIMAL(5,2)` | - | - | Nhiệt độ (°C). |
| `rhum` | `DECIMAL(5,2)` | - | - | Độ ẩm tương đối (%). |
| `prcp` | `DECIMAL(5,2)` | - | - | Lượng mưa (mm). |
| `wspd` | `DECIMAL(5,2)` | - | - | Tốc độ gió (m/s). |

*(Bảng này sử dụng Composite Primary Key: `time` + `node_id`)*

---

### 5. Bảng `flood_predictions`
Chứa kết quả suy luận mức độ ngập lụt được sinh ra từ hệ thống AI (AI Service).

| Tên cột | Kiểu dữ liệu | Primary Key (PK) | Foreign Key (FK) | Ghi chú |
|---|---|---|---|---|
| `time` | `TIMESTAMPTZ` | Có | - | Khung giờ dự báo. |
| `node_id` | `VARCHAR(50)` | Có | Trỏ đến `grid_nodes.node_id` | ID ô lưới được dự báo ngập. |
| `flood_depth_cm`| `DECIMAL(5,2)` | - | - | Độ sâu ngập dự báo (cm). |

*(Bảng này sử dụng Composite Primary Key: `time` + `node_id`)*

---

### 6. Bảng `actual_flood_reports`
Chứa báo cáo điểm ngập thực tế do người dùng gửi lên.

| Tên cột | Kiểu dữ liệu | Primary Key (PK) | Foreign Key (FK) | Ghi chú |
|---|---|---|---|---|
| `report_id` | `UUID` | Có | - | ID của báo cáo. |
| `latitude` | `DECIMAL(9,6)` | - | - | Vĩ độ người báo cáo. |
| `longitude` | `DECIMAL(9,6)` | - | - | Kinh độ người báo cáo. |
| `reported_level` | `VARCHAR(20)` | - | - | Mức độ ngập do user đánh giá ('Low', 'Medium', 'High'). |
| `user_id` | `BIGINT` | - | Trỏ đến `users.user_id` | ID người dùng gửi báo cáo. |
| `node_id` | `BIGINT` | - | Trỏ đến `grid_nodes.node_id` | Node ID gần nhất với tọa độ báo cáo. |
| `reported_at` | `TIMESTAMPTZ` | - | - | Thời điểm gửi báo cáo. |

---

## Danh sách các Materialized Views (MVs)
Được tạo ra để tăng tốc query cho Dashboard, tổng hợp các số liệu toàn thành phố.

### 1. `mv_latest_flood_predictions`
Lấy ra dự báo ngập lụt ở khung giờ mới nhất cho mỗi điểm lưới.
- **Cột:** `node_id`, `flood_depth_cm`, `time`
- **Tác dụng:** Hiển thị mảng Heatmap ngập lụt hiện tại trên bản đồ tổng quan mà không phải filter time liên tục.

### 2. `mv_global_flood_avg`
Trung bình cộng độ ngập toàn thành phố theo khung giờ.
- **Cột:** `time`, `avg_depth_cm`
- **Tác dụng:** Trả dữ liệu cho biểu đồ "Dự báo mưa" tổng quan.

### 3. `mv_global_risk_trend`
Đếm số lượng điểm ngập phân loại theo mức độ rủi ro ('safe', 'medium', 'high', 'severe') gom theo khung giờ.
- **Cột:** `bucket_time`, `risk_level`, `count`
- **Tác dụng:** Phục vụ biểu đồ "Tóm tắt rủi ro ngập" và "Xu hướng nguy cơ ngập" toàn thành phố.
