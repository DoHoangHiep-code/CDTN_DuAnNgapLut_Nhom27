# AQUAALERT – Hệ Thống Dự Báo Ngập Lụt

AQUAALERT là hệ thống dự báo ngập lụt chuyên sâu, kết hợp sức mạnh của **Trí Tuệ Nhân Tạo (AI)** và hệ thống thông tin địa lý (GIS). Dự án bao gồm Backend (Node.js/PostgreSQL), Frontend (React/Vite) và AI Service (Python/FastAPI).

Tài liệu này cung cấp hướng dẫn cài đặt và vận hành toàn bộ hệ thống từ A đến Z dành cho nhà phát triển, đảm bảo bạn có thể khởi chạy được dự án một cách dễ dàng và nhanh chóng nhất.

---

## 1. Yêu Cầu Hệ Thống (Prerequisites)

Để chạy hệ thống một cách trơn tru, máy tính của bạn cần được cài đặt sẵn:

- **Node.js** (Khuyến nghị phiên bản LTS 20.x trở lên)
- **PostgreSQL** (Khuyến nghị phiên bản 15.x trở lên cùng extension PostGIS)
- **Python** (Khuyến nghị phiên bản 3.10 trở lên)
- **Git**
- *(Tùy chọn)* **pgAdmin** hoặc DBeaver để quản lý Database bằng giao diện.

---

## 2. Kiến Trúc Dự Án

Dự án được chia thành 3 service chính, chạy độc lập và giao tiếp qua API:
- **`backend/`**: Node.js + Express + Sequelize + PostgreSQL/PostGIS. Chịu trách nhiệm xử lý API, quản lý dữ liệu không gian, phân quyền và lập lịch (cronjobs).
- **`flood-prediction-frontend/flood-prediction-system-ui/`**: Giao diện người dùng với React + Vite + TailwindCSS + Leaflet. Cung cấp bản đồ ngập lụt, dashboard thời tiết, báo cáo xuất PDF/Excel và giao diện quản trị.
- **`ai_service/`**: Microservice AI bằng Python + FastAPI. Đảm nhận nhiệm vụ suy luận (inference) từ các mô hình học máy (Machine Learning) để dự báo độ ngập.

---

## 3. Hướng Dẫn Cài Đặt & Khởi Chạy

### 3.1. Thiết Lập Cơ Sở Dữ Liệu (PostgreSQL)

1. Tạo một cơ sở dữ liệu trống có tên `flood_prediction_db` trên PostgreSQL.
   ```sql
   CREATE DATABASE flood_prediction_db;
   ```
2. Mở file `backend/src/db/config.js` hoặc tạo mới file `.env` trong thư mục `backend/` để cấu hình kết nối:
   ```env
   DB_USER=postgres
   DB_PASSWORD=123456
   DB_NAME=flood_prediction_db
   DB_HOST=127.0.0.1
   DB_PORT=5432
   PORT=3002
   JWT_SECRET=dev_secret_change_me
   AI_SERVICE_URL=http://localhost:8000
   ```

### 3.2. Khởi Chạy Backend (Node.js API)

Mở Terminal (khuyên dùng PowerShell hoặc Git Bash), di chuyển vào thư mục `backend/`:

```bash
cd backend
npm install
```

**Tự động hoá Setup Database 100%:**
Chỉ với 1 lệnh duy nhất dưới đây, hệ thống sẽ tự động tạo bảng (Migrations), chèn dữ liệu mẫu (Seeding), và chuẩn hoá trạm thời tiết/bản đồ theo địa giới hành chính 2025.
```bash
npm run setup:db
```
*(Lưu ý: Quá trình này sẽ sử dụng Administrative Interceptor để ánh xạ tọa độ GPS sang địa danh thực tế. Chi tiết xem tại `docs/ADMINISTRATIVE_2025.md`).*

**Khởi chạy Server Backend:**
```bash
npm start
```
- API chạy tại: `http://localhost:3002`
- URL Health Check: `http://localhost:3002/health`

### 3.3. Khởi Chạy AI Microservice (Bắt buộc để chạy Mô hình Dự Báo)

Mở một cửa sổ Terminal **mới**, đi vào thư mục `ai_service/`:

```bash
cd ai_service
```

Tạo và kích hoạt môi trường ảo (Virtual Environment):
- **Trên Windows:**
  ```bash
  python -m venv venv
  .\venv\Scripts\activate
  ```
- **Trên Linux/macOS:**
  ```bash
  python -m venv venv
  source venv/bin/activate
  ```

Cài đặt các thư viện cần thiết và khởi chạy Service:
```bash
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```
- AI Service chạy tại: `http://localhost:8000`
- API Dự báo (Single): `POST /api/predict`
- API Dự báo (Batch): `POST /api/predict/batch`

> [!WARNING]
> **Lưu ý Quan Trọng Trước Khi Triển Khai (Deploy):**
> Bạn cần mở file `main.py` trong `ai_service` và kiểm tra mảng `FEATURE_ORDER`. Hãy đối chiếu với cột `X_train` trong file notebook huấn luyện mô hình. Sau khi service khởi động, hệ thống sẽ log ra danh sách `model.feature_names_` – hãy lấy danh sách đó để cập nhật chính xác cho `FEATURE_ORDER` nhằm đảm bảo tensor inference không bị lệch dòng đặc trưng.

### 3.4. Khởi Chạy Frontend (React UI)

Để kết nối Frontend với Backend thực, bạn cần thiết lập file `.env` tại thư mục `flood-prediction-frontend/flood-prediction-system-ui/`:

```env
VITE_USE_MOCKS=false
VITE_API_BASE_URL=http://localhost:3002/api/v1
```
*(Lưu ý: Nếu bạn chỉ thiết kế giao diện UI và không muốn chạy Backend/AI, có thể cấu hình `VITE_USE_MOCKS=true` để dùng dữ liệu giả lập).*

Mở Terminal **thứ 3** và khởi chạy Frontend:

```bash
cd flood-prediction-frontend/flood-prediction-system-ui
npm install
npm run dev
```
- Giao diện người dùng chạy tại: `http://localhost:5173`

---

## 4. Tích Hợp Chạy Thử Mô Hình Dự Báo

Sau khi cả 3 services (Backend, AI Service, Frontend) đều đã hoạt động bình thường, bạn có thể chạy trình kích hoạt dự báo toàn cục để cập nhật dữ liệu.

Mở thêm một Terminal tại thư mục `backend/` và chạy:
```bash
npm run predict
```
Lệnh này sẽ:
1. Trích xuất các features (đặc trưng thời tiết/địa hình) theo từng điểm lưới (Nodes).
2. Gọi sang AI Service qua cổng 8000 để dự báo độ ngập.
3. Cập nhật và ghi kết quả vào bảng `flood_predictions`.
Ngay sau đó, bản đồ trên Frontend sẽ bắt đầu hiển thị các vùng ngập lụt cùng chỉ số rủi ro (Risk Level) mới nhất.

---

## 5. Tài Khoản Đăng Nhập Thử Nghiệm

Hệ thống cung cấp sẵn các tài khoản sau sau khi chạy lệnh Seed (`npm run setup:db`), ứng dụng phân quyền theo chuẩn Role-Based Access Control (RBAC):

| Phân Quyền | Tên Đăng Nhập (Username/Email) | Mật Khẩu | Chức năng truy cập được |
| --- | --- | --- | --- |
| **Admin** | admin (hoặc email trong DB) | `Admin@123` | Toàn quyền (Dashboard, Bản đồ, Báo cáo, Cài đặt Hệ thống) |
| **Expert** | expert (hoặc email trong DB) | `Expert@123` | Dashboard, Bản đồ, Báo cáo chuyên sâu, Xuất file |
| **User** | user (hoặc email trong DB) | `User@123` | Xem Dashboard, Bản đồ, Tra cứu Thời tiết |

---

## 6. Xử Lý Các Lỗi Thường Gặp (Troubleshooting)

### Lỗi 1: `EADDRINUSE` (Cổng 3002 / 5173 / 8000 đã bị chiếm dụng)
Tiến trình cũ có thể chưa tắt hẳn hoặc bị kẹt.
- **Cách khắc phục trên PowerShell (Windows):**
  ```powershell
  Stop-Process -Id (Get-NetTCPConnection -LocalPort 3002).OwningProcess -Force
  ```
  *(Thay `3002` bằng cổng đang bị kẹt).*

### Lỗi 2: Giao diện (Frontend) báo lỗi 404 Not Found từ API
- Kiểm tra lại biến môi trường `VITE_API_BASE_URL` trong file `.env` của frontend (chắc chắn có đuôi `/api/v1`).
- Đảm bảo Backend thực sự đang hoạt động và không báo lỗi Crash.

### Lỗi 3: Lệnh `npm run predict` Thất Bại (Connection Refused)
- Kiểm tra lại AI Service (FastAPI) có đang thực sự chạy ở `http://localhost:8000` hay không.
- Kiểm tra biến môi trường `AI_SERVICE_URL=http://localhost:8000` trong `backend/.env`.

---

## 7. Các Lệnh Tiện Ích Khác Dành Cho Developer

**Trong thư mục `backend/`:**
- `npm run db:migrate` – Chạy các file cấu trúc bảng (Migrations).
- `npm run db:migrate:undo` – Hủy bỏ cấu trúc của migration gần nhất.
- `npm run db:migrate:undo:all` – Hủy (Drop) toàn bộ các bảng.
- `npm run seed` – Cập nhật/Đổ dữ liệu mẫu (Seeding).

**Trong thư mục `flood-prediction-frontend/flood-prediction-system-ui/`:**
- `npm run build` – Đóng gói giao diện để chuẩn bị môi trường Deploy (Production).
- `npm run preview` – Khởi chạy nhanh máy chủ ảo để xem trước bản Build Production tại local.

---

> [!TIP]
> **Bí kíp cho thành viên mới:**
> Hãy luôn mở cố định **3 tab Terminal riêng biệt** tương ứng với Backend, AI Service và Frontend để dễ dàng phát hiện logs bất thường. Nếu có thay đổi ở bất kì file `.env` nào, bắt buộc phải tắt server (ấn `Ctrl + C`) và **chạy lại lệnh start/dev** để nạp biến môi trường mới.
