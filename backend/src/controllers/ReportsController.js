class ReportsController {
  /**
   * @param {{reportsService: any}} deps
   */
  constructor({ reportsService }) {
    this.reportsService = reportsService // Inject service
    this.list = this.list.bind(this) // Bind handler
    this.create = this.create.bind(this) // Bind handler
  }

  // GET /api/v1/reports
  async list(_req, res, next) {
    try {
      const rows = await this.reportsService.list() // Lấy danh sách

      // Chuẩn hoá shape trả về để frontend render/export ổn định
      const mapped = rows.map((r) => ({
        id: `afr_${r.report_id}`,
        createdAtIso: r.created_at,
        latitude: Number(r.latitude),
        longitude: Number(r.longitude),
        reportedLevel: r.reported_level,
        userFullName: r.user_full_name ?? null,
      }))

      // Trả về dạng { rows: [...] } để tương thích UI cũ (từng dùng mock)
      return res.status(200).json({ success: true, data: { rows: mapped } })
    } catch (err) {
      return next(err) // Đẩy lỗi cho global handler
    }
  }

  // POST /api/v1/reports
  async create(req, res, next) {
    try {
      // Lấy userId từ JWT (verifyToken đã set req.user)
      const userId = req.user?.user_id

      // Lấy payload từ body
      const { latitude, longitude, reported_level } = req.body || {}

      // Validate cơ bản để tránh insert dữ liệu rác
      if (latitude == null || longitude == null || !reported_level) {
        return res.status(400).json({ success: false, error: { message: 'Thiếu latitude/longitude/reported_level' } })
      }

      // Parse number để tránh SQL type mismatch
      const lat = Number(latitude)
      const lng = Number(longitude)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return res.status(400).json({ success: false, error: { message: 'Latitude/Longitude không hợp lệ' } })
      }

      // Tạo report (PostGIS geom sẽ được tạo trong SQL)
      const created = await this.reportsService.create({
        userId: userId ?? null,
        latitude: lat,
        longitude: lng,
        reported_level,
      })

      // Nếu insert thất bại bất thường, trả 500 an toàn
      if (!created) return res.status(500).json({ success: false, error: { message: 'Tạo báo cáo thất bại' } })

      // Trả record mới theo đúng shape list để FE có thể append nếu muốn
      const data = {
        id: `afr_${created.report_id}`,
        createdAtIso: created.created_at,
        latitude: Number(created.latitude),
        longitude: Number(created.longitude),
        reportedLevel: created.reported_level,
        userFullName: null, // join full_name có thể fetch lại bằng GET nếu cần
      }

      return res.status(201).json({ success: true, data }) // Trả record vừa tạo
    } catch (err) {
      return next(err) // Đẩy lỗi
    }
  }
}

module.exports = { ReportsController }

