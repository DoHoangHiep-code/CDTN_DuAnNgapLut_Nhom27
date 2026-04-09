class ReportsService {
  /**
   * @param {{reportsRepository: any}} deps
   */
  constructor({ reportsRepository }) {
    this.reportsRepository = reportsRepository // Inject repository để tách lớp dữ liệu khỏi business
  }

  // Lấy danh sách reports, fallback rỗng để frontend không crash
  async list() {
    const rows = await this.reportsRepository.listActualFloodReports().catch(() => [])
    return Array.isArray(rows) ? rows : []
  }

  // Tạo report mới (đã có userId từ JWT)
  async create({ userId, latitude, longitude, reported_level }) {
    const created = await this.reportsRepository.createActualFloodReport({
      userId,
      latitude,
      longitude,
      reported_level,
    })
    return created
  }
}

module.exports = { ReportsService }

