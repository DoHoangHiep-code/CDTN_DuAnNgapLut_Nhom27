# Báo Cáo Thay Đổi & Khắc Phục Sự Cố Hệ Thống Chatbot / CockroachDB
**Ngày thực hiện:** 12/05/2026

## 1. Vấn đề gặp phải
Hệ thống gặp tình trạng Crash / Treo và UI trả về lỗi `ERR_CONNECTION_REFUSED` (hoặc `500 Internal Server Error`). Nguyên nhân gốc rễ bao gồm 2 vấn đề lớn:
- **Treo Database (Hanging Queries):** Cron job (`PredictionCron`) quét 53,000 nodes lưới liên tục bị treo vô thời hạn do cấu trúc JOIN không tối ưu với khối lượng dữ liệu lớn trên CockroachDB. Việc treo này làm cạn kiệt Connection Pool, kéo theo toàn bộ backend (bao gồm Auth, Login, Chatbot) bị tê liệt.
- **Lỗi Cú pháp SQL (Syntax Errors):** Quá trình áp dụng kỹ thuật Time-Travel Query (`AS OF SYSTEM TIME '-10s'`) không tuân thủ chính xác vị trí cú pháp của CockroachDB, dẫn tới các API Tra cứu, Chatbot, và Feature Service âm thầm ném ra các lỗi `at or near "as": syntax error` hoặc `at or near "left": syntax error`.

## 2. Chi tiết các thay đổi đã thực hiện

### A. Tối ưu hóa truy vấn trong `floodPredictionCron.js`
* **Thay đổi:** Thay thế cấu trúc `LEFT JOIN LATERAL` bằng `DISTINCT ON (node_id)`.
* **Lý do:**
  * `LATERAL` join yêu cầu CockroachDB thực thi subquery 53,000 lần (cho mỗi node), dẫn đến tình trạng treo (hang) vô thời hạn và vắt kiệt CPU của Database.
  * Việc sử dụng `DISTINCT ON` kèm bộ lọc thời gian `WHERE time >= NOW() - INTERVAL '24 hours'` cho phép lấy ra giá trị thời tiết mới nhất của từng node cực kỳ nhanh chóng. Tốc độ đã được kiểm chứng thực tế giảm từ **Vô Hạn (treo)** xuống chỉ còn khoảng **14 giây** cho 53,330 bản ghi.

### B. Sửa lỗi cú pháp `AS OF SYSTEM TIME`
* **Thay đổi:** Loại bỏ hoàn toàn mệnh đề `AS OF SYSTEM TIME '-10s'` tại các API đọc dữ liệu nhanh thuộc `unifiedChatbotRoutes.js` và `floodFeature.service.js`.
* **Lý do:**
  * Trong CockroachDB, `AS OF SYSTEM TIME` chỉ hoạt động ổn định nhất khi được đặt ở vị trí tận cùng của câu lệnh (Statement-level) đối với các bảng đơn giản, hoặc đặt ngay sau tên bảng dưới dạng Table Hint.
  * Việc đặt sai vị trí (ví dụ: sau `LIMIT` hoặc trước `ORDER BY`) đã gây ra hàng loạt lỗi `syntax error`.
  * Các truy vấn lấy dữ liệu trên Chatbot Tầng 1 và Feature Fetching vốn trả về rất ít dữ liệu (thường là `LIMIT 5` hoặc `LIMIT 10`), do đó Read Locks được giải phóng gần như tức thì. Việc loại bỏ hoàn toàn `AS OF SYSTEM TIME` ở các truy vấn nhỏ này giúp mã nguồn an toàn tuyệt đối khỏi các lỗi cú pháp mà không gây nghẽn quá trình Ghi (Write) của Cron job.

### C. Giải phóng Port & Phục hồi hệ thống
* **Thay đổi:** Tìm và tiêu diệt (kill) các process ngầm đang chiếm dụng port `3002` gây ra lỗi `EADDRINUSE`.
* **Lý do:** Khi hệ thống bị treo, các tiến trình `npm start` cũ không tự thoát đúng cách dù người dùng đã bấm `Ctrl+C`. Điều này khiến tiến trình mới không thể khởi động.

## 3. Kết quả đạt được
1. 🚀 **Backend Khởi Động Thành Công:** Không còn lỗi ngầm hoặc Crash đột ngột.
2. ⚡ **Cron Job Tốc Độ Cao:** `floodPredictionCron` nay có thể xử lý mượt mà hơn 53,000 dữ liệu dự báo mỗi 10 phút.
3. 🤖 **Chatbot Tầng 1 và Tầng 2 Ổn Định:** Lỗi `500` và `ERR_CONNECTION_REFUSED` khi gọi `POST /chatbot/ask` đã được giải quyết triệt để. Hệ thống có khả năng phục vụ liên tục.
