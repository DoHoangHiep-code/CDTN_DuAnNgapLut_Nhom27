'use strict'

/**
 * config/weatherStations.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Danh sách 8 "Trạm Thời Tiết Đại Diện" cho Hà Nội.
 *
 * Mục đích:
 *   Thay vì gọi Open-Meteo/OpenWeather cho 53.291 grid nodes riêng lẻ,
 *   hệ thống phân cụm (cluster) toàn bộ nodes về 8 trạm này dựa trên
 *   khoảng cách Euclidean (lat/lon). Mỗi cron run chỉ cần 8 API calls.
 *
 * Cách hoạt động:
 *   1. Script `assign_stations.js` chạy 1 lần → gán weather_station_id cho mỗi GridNode
 *   2. Cronjob fetch weather cho 8 trạm → share data cho tất cả node trong cụm
 *   3. AI inference vẫn dùng đặc trưng địa lý riêng từng node (elevation, slope, ...)
 *
 * Cập nhật: Có thể thêm trạm mới hoặc thay đổi tọa độ mà không cần sửa code chính.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** @type {Array<{ id: number, name: string, lat: number, lon: number }>} */
const WEATHER_STATIONS = [
  {
    id:   1,
    name: 'Hoàn Kiếm – Ba Đình',
    lat:  21.0306,
    lon:  105.8470,
    // Phủ sóng: Hoàn Kiếm, Ba Đình, Đống Đa phía Bắc
  },
  {
    id:   2,
    name: 'Thanh Xuân – Đống Đa',
    lat:  21.0028,
    lon:  105.8153,
    // Phủ sóng: Thanh Xuân, Đống Đa phía Nam, Nguyễn Trãi corridor
  },
  {
    id:   3,
    name: 'Cầu Giấy – Nam Từ Liêm',
    lat:  21.0303,
    lon:  105.7865,
    // Phủ sóng: Cầu Giấy, Nam Từ Liêm, khu vực Phố Hoa Bằng
  },
  {
    id:   4,
    name: 'Hoàng Mai – Hai Bà Trưng',
    lat:  20.9845,
    lon:  105.8423,
    // Phủ sóng: Hoàng Mai, HBT phía Nam, bến xe Giáp Bát
  },
  {
    id:   5,
    name: 'Long Biên',
    lat:  21.0445,
    lon:  105.8755,
    // Phủ sóng: Long Biên, Ngọc Lâm, Gia Lâm phía Tây
  },
  {
    id:   6,
    name: 'Tây Hồ – Bắc Từ Liêm',
    lat:  21.0667,
    lon:  105.8041,
    // Phủ sóng: Tây Hồ, Bắc Từ Liêm, Phú Thượng
  },
  {
    id:   7,
    name: 'Hà Đông',
    lat:  20.9716,
    lon:  105.7725,
    // Phủ sóng: Hà Đông, Thanh Oai phía Bắc, Mỗ Lao
  },
  {
    id:   8,
    name: 'Đông Anh (Ngoại thành Bắc)',
    lat:  21.1416,
    lon:  105.8973,
    // Phủ sóng: Đông Anh, Gia Lâm phía Bắc, Sóc Sơn phía Nam
  },
]

module.exports = WEATHER_STATIONS
