const { getWeatherByCoords } = require('../../../common/services/OpenWeatherService')

class ReportsService {
  /**
   * @param {{reportsRepository: any}} deps
   */
  constructor({ reportsRepository }) {
    this.reportsRepository = reportsRepository // Inject repository để tách lớp dữ liệu khỏi business
  }

  async getHotspots() {
    const TARGETS = ['Phường Cầu Giấy', 'Phường Hoàn Kiếm', 'Phường Đống Đa', 'Phường Hà Đông']
    
    // Bước 1: Fetch từ DB
    const dbRows = await this.reportsRepository.getHotspots()
    const mapped = new Map()
    for (const r of dbRows) {
      mapped.set(r.district_name, r)
    }

    // Bước 2: Bổ sung/Fallback nếu DB trống
    const results = []
    for (const district of TARGETS) {
      let data = mapped.get(district)
      if (!data || data.temp === null) {
        // Fallback: Gọi OWM API
        let fallbackLat, fallbackLon
        if (data) {
          fallbackLat = data.latitude
          fallbackLon = data.longitude
        } else {
          // Hardcode một số tọa độ dự phòng nếu hoàn toàn không có node trong DB
          const COORDS = {
            'Phường Cầu Giấy': { lat: 21.0366, lon: 105.7820 },
            'Phường Hoàn Kiếm': { lat: 21.0285, lon: 105.8542 },
            'Phường Đống Đa': { lat: 21.0181, lon: 105.8277 },
            'Phường Hà Đông': { lat: 20.9733, lon: 105.7723 }
          }
          fallbackLat = COORDS[district].lat
          fallbackLon = COORDS[district].lon
        }
        
        try {
          const liveData = await getWeatherByCoords(fallbackLat, fallbackLon)
          data = {
            district_name: district,
            temp: liveData.temp,
            rhum: liveData.humidity,
            prcp: liveData.rain1h || 0,
            flood_depth_cm: 0, // Fallback -> độ ngập tạm = 0
            is_fallback: true
          }
        } catch (err) {
          console.error(`[ReportsService] Fallback OWM failed for ${district}:`, err?.message || err)
          data = {
            district_name: district,
            temp: 0,
            rhum: 0,
            prcp: 0,
            flood_depth_cm: 0,
            is_fallback: true
          }
        }
      }

      results.push({
        name: data.district_name,
        temp: Number(data.temp),
        humidity: Number(data.rhum),
        rain: Number(data.prcp),
        floodDepth: Number(data.flood_depth_cm),
        is_fallback: !!data.is_fallback
      })
    }

    return results
  }

  // Lấy danh sách reports có phân trang + filter (location, dateFrom, dateTo)
  async list({ page = 1, limit = 50, location, dateFrom, dateTo } = {}) {
    const result = await this.reportsRepository
      .listActualFloodReports({ page, limit, location, dateFrom, dateTo })
      .catch(() => ({ rows: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } }))
    return result
  }

  // Autocomplete địa điểm từ grid_nodes (trả nhanh, timeout 3s)
  async searchLocations(q) {
    return this.reportsRepository.searchLocations(q).catch(() => [])
  }

  /**
   * Tạo báo cáo ngập lụt mới.
   *
   * @param {object} opts
   * @param {number|null} opts.userId      – ID người dùng (null nếu anonymous qua optionalAuth)
   * @param {number}      opts.latitude    – Vĩ độ
   * @param {number}      opts.longitude   – Kinh độ
   * @param {string}      opts.reported_level – Mức ngập ENUM tiếng Việt
   * @param {object}      [opts.geom]      – GeoJSON Point (tuỳ chọn; repository tự tính bằng PostGIS nếu thiếu)
   * @returns {Promise<object|null>}
   */
  async create({ userId, latitude, longitude, reported_level, geom, node_id }) {
    const created = await this.reportsRepository.createActualFloodReport({
      userId,
      latitude,
      longitude,
      reported_level,
      // geom được forward nhưng repository hiện tự tạo bằng ST_MakePoint(PostGIS)
      // → giữ để interface rõ ràng và dễ mở rộng sau
      geom,
      node_id,
    })
    return created
  }
}

module.exports = { ReportsService }

