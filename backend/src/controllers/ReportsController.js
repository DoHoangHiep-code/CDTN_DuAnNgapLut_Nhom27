class ReportsController {
  /**
   * @param {{reportsService: any}} deps
   */
  constructor({ reportsService }) {
    this.reportsService = reportsService
    this.list = this.list.bind(this)
    this.autocomplete = this.autocomplete.bind(this)
    this.create = this.create.bind(this)
    this.createActualFloodReport = this.createActualFloodReport.bind(this)
  }

  // GET /api/v1/reports/autocomplete?q=Cầu Giấy
  async autocomplete(req, res, next) {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : ''
      const results = await this.reportsService.searchLocations(q)
      return res.status(200).json({ success: true, data: results })
    } catch (err) {
      return next(err)
    }
  }

  // GET /api/v1/reports?page=1&limit=50&location=&dateFrom=&dateTo=
  async list(req, res, next) {
    try {
      const { page = 1, limit = 50, location, dateFrom, dateTo } = req.query
      const result = await this.reportsService.list({ page, limit, location, dateFrom, dateTo })

      // Chuẩn hoá shape trả về để frontend render/export ổn định
      const mapped = result.rows.map((r) => ({
        id: `afr_${r.report_id}`,
        createdAtIso: r.reported_at,
        latitude: Number(r.latitude),
        longitude: Number(r.longitude),
        reportedLevel: r.flood_depth_cm ? `${r.flood_depth_cm} cm` : r.description,
        userFullName: r.user_full_name ?? null,
      }))

      // Trả về dạng { rows, pagination } – backward compat: rows vẫn ở đó
      return res.status(200).json({
        success: true,
        data: { rows: mapped, pagination: result.pagination },
      })
    } catch (err) {
      return next(err)
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
        description: reported_level, // backward compatibility
        flood_depth_cm: 0,
      })

      // Nếu insert thất bại bất thường, trả 500 an toàn
      if (!created) return res.status(500).json({ success: false, error: { message: 'Tạo báo cáo thất bại' } })

      // Trả record mới theo đúng shape list để FE có thể append nếu muốn
      const data = {
        id: `afr_${created.report_id}`,
        createdAtIso: created.reported_at,
        latitude: Number(created.latitude),
        longitude: Number(created.longitude),
        reportedLevel: created.description,
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

      // Map 'severity' từ frontend sang depth
      const DESC_MAP = {
        none:   'Khô ráo (0cm)',
        low:    'Ngập nhẹ (<15cm)',
        medium: 'Ngập vừa (15-30cm)',
        high:   'Ngập sâu (>30cm)',
      }
      const DEPTH_MAP = { none: 0, low: 10, medium: 20, high: 40 }
      
      const descriptionText = DESC_MAP[severity]
      if (!descriptionText) {
        return res.status(400).json({
          success: false,
          error: { message: `Mức độ ngập không hợp lệ: "${severity}". Chấp nhận: none, low, medium, high.` },
        })
      }
      
      const flood_depth_cm = DEPTH_MAP[severity]
      const description = note ? `${descriptionText} - ${note}` : descriptionText

      // Lưu vào DB qua service hiện có
      const created = await this.reportsService.create({
        userId,
        latitude,
        longitude,
        flood_depth_cm,
        description,
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
          createdAtIso: created.reported_at,
          latitude: Number(created.latitude),
          longitude: Number(created.longitude),
          reportedLevel: created.flood_depth_cm ? `${created.flood_depth_cm} cm` : created.description,
        },
      })
    } catch (err) {
      console.error('[ReportsController.createActualFloodReport] Lỗi:', err)
      return next(err) // Đẩy lỗi cho global error handler
    }
  }
}

module.exports = { ReportsController }
