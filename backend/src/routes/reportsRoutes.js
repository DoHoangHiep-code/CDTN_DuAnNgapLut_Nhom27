const express = require('express') // Import express để tạo router
const { sequelize } = require('../db/sequelize') // Import sequelize để inject repository
const { verifyToken } = require('../middlewares/auth.middleware') // Middleware xác thực JWT
const { optionalAuth } = require('../middlewares/optionalAuth.middleware') // Middleware JWT tuỳ chọn (không bắt lỗi nếu thiếu token)
const { ReportsRepository } = require('../repositories/ReportsRepository') // Repository reports
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

// ── Route yêu cầu đăng nhập ──
// Bảo vệ các route còn lại: phải đăng nhập mới xem/gửi report
router.use(verifyToken) // Nếu token lỗi → 401 ngay, tránh leak data

// GET danh sách reports (dành cho admin/dashboard)
router.get('/reports', reportsController.list)

// POST tạo report theo schema cũ (latitude/longitude/reported_level)
router.post('/reports', reportsController.create)

module.exports = { reportsRouter: router } // Export router

