class ReportsController {
  /**
   * @param {{reportsService: any}} deps
   */
  constructor({ reportsService }) {
    this.reportsService = reportsService // Inject service
    this.list = this.list.bind(this)                         // Bind handler
    this.create = this.create.bind(this)                     // Bind handler
    this.createActualFloodReport = this.createActualFloodReport.bind(this) // Bind handler cho route /actual-flood
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
      // Route này đã qua verifyToken → req.user luôn tồn tại nếu token hợp lệ
      // Guard thêm để phòng trường hợp middleware bị bypass hoặc payload JWT thiếu user_id
      const userId = req.user?.user_id
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: { message: 'Bạn cần đăng nhập để gửi báo cáo này.' },
        })
      }

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

      // Tạo report với user_id đã xác thực (KHÔNG còn nullable)
      const created = await this.reportsService.create({
        userId,          // ← user_id luôn có giá trị tại đây
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
  // POST /api/v1/reports/actual-flood
  // Nhận payload từ FloodReportModal: { lat, lng, severity, note }
  // Map sang schema DB: latitude, longitude, geom (GeoJSON), reported_level (ENUM tiếng Việt)
  async createActualFloodReport(req, res, next) {
    try {
      // Lấy userId từ JWT nếu có (route này có thể public hoặc protected)
      const userId = req.user?.user_id ?? null

      // Frontend gửi: lat, lng, severity ('none'|'low'|'medium'|'high'), note
      const { lat, lng, severity, note } = req.body || {}

      // Validate bắt buộc: lat và lng phải có mặt
      if (lat == null || lng == null) {
        return res.status(400).json({
          success: false,
          error: { message: 'Thiếu tham số bắt buộc: lat và lng.' },
        })
      }

      // Parse và kiểm tra giá trị số hợp lệ
      const latitude = Number(lat)
      const longitude = Number(lng)
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return res.status(400).json({
          success: false,
          error: { message: 'lat/lng phải là số thực hợp lệ.' },
        })
      }

      // Map 'severity' từ frontend sang giá trị ENUM tiếng Việt trong DB
      // Thứ tự: none → Khô ráo, low → <15cm, medium → 15-30cm, high → >30cm
      const LEVEL_MAP = {
        none:   'Khô ráo',
        low:    '<15cm',
        medium: '15-30cm',
        high:   '>30cm',
      }
      const reported_level = LEVEL_MAP[severity]
      if (!reported_level) {
        return res.status(400).json({
          success: false,
          error: { message: `Mức độ ngập không hợp lệ: "${severity}". Chấp nhận: none, low, medium, high.` },
        })
      }

      // Xây dựng geometry GeoJSON chuẩn SRID 4326 để lưu vào PostGIS
      // QUAN TRỌNG: GeoJSON quy định coordinates = [longitude, latitude] (kinh độ trước)
      const geom = { type: 'Point', coordinates: [longitude, latitude] }

      // Lưu vào DB qua service hiện có (tái dụng logic đã có sẵn)
      const created = await this.reportsService.create({
        userId,
        latitude,
        longitude,
        geom,
        reported_level,
        // 'note' chưa có cột trong DB → bỏ qua khi insert
        // TODO: thêm cột 'note TEXT' vào bảng actual_flood_reports nếu cần lưu
      })

      if (!created) {
        return res.status(500).json({
          success: false,
          error: { message: 'Tạo báo cáo thất bại, vui lòng thử lại.' },
        })
      }

      // Trả về thông báo thân thiện theo yêu cầu frontend
      return res.status(201).json({
        success: true,
        message: 'Đã lưu báo cáo hiện trường!',
        data: {
          id: `afr_${created.report_id}`,
          createdAtIso: created.created_at,
          latitude: Number(created.latitude),
          longitude: Number(created.longitude),
          reportedLevel: created.reported_level,
        },
      })
    } catch (err) {
      console.error('[ReportsController.createActualFloodReport] Lỗi:', err)
      return next(err) // Đẩy lỗi cho global error handler
    }
  }
}

module.exports = { ReportsController }
