# Kiến trúc và Luồng xử lý Dashboard

Tài liệu này giải thích ngắn gọn luồng xử lý dữ liệu và UI trên trang Dashboard.

## Luồng tìm kiếm và hiển thị dữ liệu

1. **Frontend gõ tìm kiếm (Location Search):**
   - Khi người dùng nhập từ khóa tìm kiếm (ví dụ: "Thanh Oai"), Frontend gửi request đến `/api/v1/dashboard/locations`.
   - Backend sử dụng query `SELECT DISTINCT location_name FROM grid_nodes WHERE location_name ILIKE :pattern AND location_name IS NOT NULL` để lấy danh sách tên các xã/phường. Việc dùng `DISTINCT` giúp danh sách dropdown không bị lặp lại các dòng của cùng một địa điểm.

2. **Click chọn xã/phường (Resolve Nodes):**
   - Khi người dùng click chọn một xã/phường cụ thể từ dropdown, Frontend sẽ gửi `location_name` này đến API lấy dữ liệu `/api/v1/dashboard/location-data`.
   - Backend chạy hàm `resolveNodes` với truy vấn `SELECT node_id, weather_station_id FROM grid_nodes WHERE location_name = :pattern` (Không giới hạn `LIMIT`). Việc này giúp lấy **tất cả** các node lưới và trạm thời tiết (ảo) thuộc vùng địa lý đó.

3. **Backend tính gộp dữ liệu (AVG/MAX):**
   - Sau khi có danh sách `node_id` và `weather_station_id`, Backend song song truy vấn các bảng `weather_measurements` và `flood_predictions`.
   - Để đại diện chính xác cho toàn bộ xã/phường, hệ thống gộp dữ liệu theo từng khung giờ bằng các hàm SQL Aggregate:
     - `AVG(temp)`, `AVG(rhum)`: Lấy nhiệt độ và độ ẩm trung bình.
     - `MAX(prcp)`, `MAX(flood_depth_cm)`: Lấy mức mưa và độ ngập lớn nhất để đảm bảo không bỏ sót nguy cơ ngập lụt cục bộ trong vùng.

4. **Trả về mảng 72h:**
   - Backend luôn thực hiện các truy vấn này trong khoảng thời gian `time >= now() AND time < now() + interval '72 hours'`.
   - Dữ liệu trả về cho Frontend là một mảng time-series 72 giờ chuẩn xác, có các mốc thời gian được nhóm theo từng giờ (định dạng `HH:mm`).

5. **Frontend slice theo nút lọc giờ:**
   - Frontend lưu trữ toàn bộ mảng dữ liệu 72 giờ vào State (Ví dụ: `data.forecast24h`).
   - Có một State `timeRange` quản lý nút bấm lọc thời gian của người dùng (24h, 48h, 72h), mặc định là 72.
   - Thay vì gọi lại API mỗi lần bấm lọc, Frontend tính toán `chartData = apiData.slice(0, timeRange)` và truyền dữ liệu đã bị cắt ngắn tương ứng vào cho các biểu đồ (Rain/Flood Chart, Temp/Humidity Chart, Risk Trend).
   - Biểu đồ tự động render lại ngay lập tức với trục X dàn đều các mốc `HH:mm`. Trục X không bao giờ bị bỏ trống, đảm bảo tính liên tục của UI.
