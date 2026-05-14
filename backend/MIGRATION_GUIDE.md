# 🚀 Hướng Dẫn Di Chuyển sang CockroachDB Server Mới

## 📋 Thông Tin Server Mới
- **Server**: ninja-hacker-15200.jxf.gcp-asia-southeast1.cockroachlabs.cloud
- **Port**: 26257
- **Database**: defaultdb
- **Region**: GCP Asia Southeast
- **SSL**: Bắt buộc (sslmode=verify-full)

## 🎯 Quy Trình

Script migration sẽ tự động thực hiện:

1. ✅ **Kết nối** cả 2 server (cũ & mới)
2. ✅ **Dump** toàn bộ schema + dữ liệu từ server cũ
3. ✅ **Tạo backup** file JSON để rollback nếu cần
4. ✅ **Tạo schema** trên server mới (CREATE TABLE, INDEX)
5. ✅ **Import dữ liệu** vào server mới
6. ✅ **Xác minh** dữ liệu
7. ✅ **Populate cache** cho chatbot & dashboard

## ✅ Các Bước Thực Hiện

### 1️⃣ Cập Nhật Cấu Hình (Đã Hoàn Tất)
- ✓ File `.env` đã cập nhật DATABASE_URL mới
- ✓ File `.env.example` đã cập nhật cho tương lai

### 2️⃣ Di Chuyển Dữ Liệu

#### Cách 1: Sử dụng Script Tự Động (Khuyến Khích)

```bash
cd backend
npm install  # Nếu chưa cài dependencies
node migrate-cockroachdb.js
```

**Tác dụng**:
- ✓ Kết nối tới DB cũ (cosmic-kite) & DB mới (ninja-hacker)
- ✓ Dump toàn bộ dữ liệu từ DB cũ
- ✓ Tạo backup file `cockroachdb_backup_[timestamp].json`
- ✓ Import dữ liệu vào DB mới
- ✓ Xác minh dữ liệu

**Output ví dụ**:
```
╔════════════════════════════════════════════════════════╗
║   MIGRATION: PostgreSQL → CockroachDB (Cloud)        ║
╚════════════════════════════════════════════════════════╝

✓ Kết nối DB CŨ thành công
✓ Kết nối DB MỚI thành công

▶ DUMP DỮ LIỆU TỬ DB CŨ...
Tìm thấy 8 bảng

  → Dumped users: 5 rows
  → Dumped weather_stations: 120 rows
  ...

✓ Backup đã lưu: cockroachdb_backup_1715618234567.json

✓ MIGRATION HOÀN TẤT THÀNH CÔNG!
```

#### Cách 2: Sử dụng pg_dump (Tùy Chọn)

Nếu bạn có psql/pg_dump cài đặt:

```bash
# Dump từ DB cũ
pg_dump "postgresql://h1234561:W9gqW225ZIMsX6Cdin-g1w@cosmic-kite-15897.jxf.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full" > backup.sql

# Restore vào DB mới
psql "postgresql://s_:_rIigkJpJxIP9RJUS4OkTw@ninja-hacker-15200.jxf.gcp-asia-southeast1.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full" < backup.sql
```

## 3️⃣ Populate Cache (Tùy Chọn)

Nếu bạn cần cache được sẵn sàng ngay mà không chờ CronJob:

```bash
npm run cache:populate
```

**Tác dụng**:
- ✓ Lấy top 10 khu vực nguy cơ cao nhất
- ✓ Lấy dữ liệu thời tiết hiện tại  
- ✓ Tính toán tóm tắt rủi ro cho 96 giờ tới
- ✓ Chuẩn bị dashboard cache

**Khi nào cần chạy**:
- Sau migration nếu muốn cache được sẵn sàng ngay
- Hoặc để cực kỳ tùy chọn — cache sẽ được populate tự động sau khi backend chạy

### 4️⃣ Khởi Động Backend

```bash
npm start
```

**Kiểm tra logs**: 
- Không có lỗi kết nối database
- Không có lỗi "ECONNREFUSED" hoặc "SSL error"
- Log hiển thị "Backend listening on :3002"

### 5️⃣ Test API

```bash
curl http://localhost:3002/api/health
```

## 🔍 Khắc Phục Sự Cố

### Lỗi: "type "risk_level" does not exist"

Lỗi này xảy ra khi ENUM types chưa được tạo trên CockroachDB mới.

**Giải pháp**:

```bash
# Cách 1: Chạy script fix ENUM types
npm run db:fix-enums

# Cách 2: Chạy migrations để tạo ENUM types
npm run db:migrate

# Cách 3: Chạy migration từ đầu (tự động tạo ENUM types)
npm run db:migrate:cockroachdb
```

**Kiểm tra**:
```bash
# Kiểm tra ENUM types đã tồn tại
npm start  # Restart backend
```

---
- Kiểm tra DATABASE_URL đúng trong `.env`
- Đảm bảo VPN/Firewall cho phép kết nối
- Thử lại: `node migrate-cockroachdb.js`

### Lỗi: "SSL Error" hoặc "Certificate Verification Failed"
- Cấu hình tự động xử lý (rejectUnauthorized: false)
- Nếu vẫn lỗi, thử xóa `?sslmode=verify-full` và dùng `?sslmode=require`

### Lỗi: "Password Authentication Failed"
- Kiểm tra lại credentials trong DATABASE_URL
- Lưu ý: ký tự đặc biệt (`_`, `-`, số) có thể gây vấn đề
- Script tự động encode mật khẩu

### Lỗi: "Database Does Not Exist"
- CockroachDB mới cần tạo database `defaultdb`
- Script sẽ tự động tạo khi dump/restore

## 📊 Danh Sách Bảng (Được Di Chuyển)

Các bảng sau sẽ được migrate:
- `users` - Tài khoản người dùng
- `weather_stations` - Trạm thời tiết
- `weather_measurements` - Dữ liệu thời tiết
- `flood_predictions` - Dự báo ngập lụt
- `actual_flood_reports` - Báo cáo ngập thực tế
- `grid_nodes` - Lưới dự báo
- `system_logs` - Logs hệ thống
- Bất kỳ bảng nào khác trong database

## � Về Cache Trong Ứng Dụng

### Cache Layers

Ứng dụng sử dụng **3 tầng cache**:

1. **In-Memory Cache (NodeCache)**
   - Lưu Dashboard data (TTL: 5 phút)
   - Không cần Redis, tích hợp sẵn

2. **Flood Prediction Cache (floodCache)**
   - Top 10 khu vực nguy cơ cao nhất
   - Được cập nhật mỗi 10 phút bởi `FloodPredictionCron`
   - Cấu trúc: `worstAreas`, `currentStatus`, `forecastSummary`

3. **Redis Cache** (Tùy chọn)
   - Để chia sẻ cache giữa nhiều backend instances
   - Không bắt buộc nếu chỉ chạy 1 instance

### Auto-Population

Cache **tự động được populate** khi:
- Backend start → CronJobs khởi động
- `startFloodPredictionCron()` chạy mỗi 10 phút
- `startWeatherCron()` chạy mỗi 1 giờ
- `startBackupCron()` chạy hàng ngày

### Trigger Thủ Công

Nếu muốn cache được sẵn sàng **ngay lập tức** sau migration:

```bash
# Cách 1: Populate script
npm run cache:populate

# Cách 2: API trigger (khi backend chạy)
curl http://localhost:3002/api/v1/cron/trigger
```

---

## 🎯 Checklist

- [ ] Cập nhật .env (✓ Đã Done)
- [ ] Chạy kiểm tra kết nối: `npm run db:check`
- [ ] Chạy script migration: `npm run db:migrate:cockroachdb`
- [ ] Nếu gặp lỗi ENUM: `npm run db:fix-enums`
- [ ] Kiểm tra backup được tạo: `cockroachdb_backup_*.json`
- [ ] Xác minh dữ liệu trên DB mới
- [ ] Populate cache (tùy chọn): `npm run cache:populate`
- [ ] Khởi động backend: `npm start`
- [ ] Test API endpoint: `curl http://localhost:3002/api/health`
- [ ] Kiểm tra logs trong terminal (không có ENUM errors)
- [ ] Verify CronJob chạy (WeatherCron, FloodPredictionCron)

## ❓ Câu Hỏi Thường Gặp

**Q: Migration mất bao lâu?**
A: Tùy vào kích thước dữ liệu, thường 5-30 giây. Script sẽ tự động tạo ENUM types.

**Q: Có downtime không?**
A: Có downtime nhỏ (~1-2 phút). Tránh script trong giờ cao điểm.

**Q: Dữ liệu cũ vẫn ở server cũ được không?**
A: Có, script chỉ copy, không xóa. Bạn có thể giữ server cũ như backup.

**Q: Sao cache không được populate?**
A: Cache được populate tự động bởi CronJob mỗi 10 phút khi backend chạy. Nếu muốn ngay: `npm run cache:populate`

**Q: Lỗi "type risk_level does not exist"?**
A: Chạy: `npm run db:fix-enums` để tạo ENUM types. Script migration mới sẽ tự động tạo.

**Q: Webhook/CronJob thì sao?**
A: Các CronJob tự động khởi động khi backend start. Không cần setup thêm.

**Q: Cần cập nhật gì khác?**
A: Không. Sequelize tự động tương thích với CockroachDB.

---

**🚀 Sẵn sàng? Chạy lệnh này để bắt đầu:**
```bash
cd backend
node migrate-cockroachdb.js
```
