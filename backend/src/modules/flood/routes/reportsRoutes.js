const express = require('express') // Import express để tạo router
const { sequelize } = require('../../../db/sequelize') // Import sequelize để inject repository
const { verifyToken } = require('../../../common/middlewares/auth.middleware') // Middleware xác thực JWT
const { optionalAuth } = require('../../../common/middlewares/optionalAuth.middleware') // Middleware JWT tuỳ chọn (không bắt lỗi nếu thiếu token)
const { ReportsRepository } = require('../../../repositories/ReportsRepository') // Repository reports
const { ReportsService } = require('../services/ReportsService') // Service reports
const { ReportsController } = require('../controllers/ReportsController') // Controller reports

const router = express.Router() // Tạo router

// Khởi tạo các lớp theo Service/Repository pattern
const reportsRepository = new ReportsRepository({ sequelize }) // Inject sequelize
const reportsService = new ReportsService({ reportsRepository }) // Inject repo
const reportsController = new ReportsController({ reportsService }) // Inject service

// ── Route công khai (optional auth): nhận báo cáo từ FloodReportModal ──
// Dùng optionalAuth thay verifyToken để người dùng chưa đăng nhập vẫn gửi được
// userId sẽ là null nếu không có token → DB ghi NULL vào cột user_id
router.post('/reports/actual-flood', optionalAuth, reportsController.createActualFloodReport)

// GET hotspots (thẻ Giám sát khu vực trọng điểm ở Reports)
router.get('/reports/hotspots', optionalAuth, reportsController.getHotspots.bind(reportsController))

// ── Route yêu cầu đăng nhập ──
router.use(verifyToken)

// GET autocomplete địa điểm (phải đứng TRƯỚC /reports để Express match đúng)
router.get('/reports/autocomplete', reportsController.autocomplete)

// GET danh sách reports – hỗ trợ ?location=&dateFrom=&dateTo=&page=&limit=
router.get('/reports', reportsController.list)

// POST tạo report theo schema cũ (latitude/longitude/reported_level)
router.post('/reports', reportsController.create)

module.exports = { reportsRouter: router } // Export router

