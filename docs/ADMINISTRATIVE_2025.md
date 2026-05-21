# Hệ Thống Chuẩn Hành Chính Hà Nội 2025 (Administrative Interceptor)

## 1. Mục đích

Hệ thống AQUAALERT đã áp dụng toàn bộ chuẩn hành chính mới nhất của thủ đô Hà Nội, dự kiến bắt đầu có hiệu lực từ ngày 01/07/2025, liên quan đến việc sáp nhập 126 xã/phường. 

Vấn đề cốt lõi: Các dịch vụ bản đồ mã nguồn mở như OpenStreetMap (Nominatim) thường có độ trễ rất lớn (vài năm) trong việc cập nhật địa giới hành chính của Việt Nam. Nếu sử dụng nguyên gốc dữ liệu trả về từ API này, ứng dụng sẽ hiển thị tên các phường/xã cũ không còn tồn tại, gây nhầm lẫn nghiêm trọng cho công tác cứu hộ và cảnh báo.

## 2. Giải pháp: Mapping Dictionary & Interceptor

Để vượt qua giới hạn chậm cập nhật của OpenStreetMap API, chúng tôi áp dụng cơ chế **Administrative Interceptor**:

1. **Mapping Dictionary:** Lưu trữ một từ điển JSON ánh xạ (`scripts/administrative_mapping_2025.json`) chứa toàn bộ quy định sáp nhập 1-1 (Ví dụ: "Phường Hàng Bạc" -> "Phường Hoàn Kiếm").
2. **Interceptor Logic:** Tại bước Geocoding dữ liệu tọa độ gốc (script `geocode_location_names.js`), sau khi nhận được phản hồi từ Nominatim API, hệ thống sẽ thực hiện đối chiếu chéo tên Phường/Xã nhận được với Mapping Dictionary.
3. **Overriding:** Nếu phát hiện phường/xã nằm trong diện sáp nhập, hệ thống sẽ tự động ép kiểu (Override) sang tên Phường/Xã mới. Đồng thời, tự động suy luận lại Quận/Huyện tương ứng nếu có sự thay đổi.

## 3. Quy trình Triển khai (CI/CD)

Khi triển khai hệ thống mới ở môi trường Production, để chạy tự động toàn bộ quá trình ánh xạ này, chỉ cần sử dụng lệnh Setup DB duy nhất:

```bash
npm run setup:db
```

Quá trình này sẽ:
- Dựng cấu trúc Schema PostgreSQL/PostGIS.
- Seed dữ liệu 88 trạm thời tiết.
- Tiến hành chia lưới 53.000+ nodes, gọi Nominatim API.
- **Tự động áp dụng bộ chuyển đổi hành chính 2025** vào toàn bộ 53.000 nodes này trước khi ghi xuống Database.

## 4. Bảo trì

Mọi thay đổi mới về địa giới hành chính trong tương lai chỉ cần được cập nhật vào file `administrative_mapping_2025.json`. Không cần can thiệp logic code cốt lõi.
