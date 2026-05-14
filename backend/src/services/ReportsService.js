class ReportsService {
  /**
   * @param {{reportsRepository: any}} deps
   */
  constructor({ reportsRepository }) {
    this.reportsRepository = reportsRepository // Inject repository để tách lớp dữ liệu khỏi business
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
  async create({ userId, latitude, longitude, reported_level, geom }) {
    const created = await this.reportsRepository.createActualFloodReport({
      userId,
      latitude,
      longitude,
      reported_level,
      // geom được forward nhưng repository hiện tự tạo bằng ST_MakePoint(PostGIS)
      // → giữ để interface rõ ràng và dễ mở rộng sau
      geom,
    })
    return created
  }
}

module.exports = { ReportsService }

