const express = require('express') // Import express để tạo router
const { sequelize } = require('../db/sequelize') // Import sequelize để inject repository
const { verifyToken } = require('../middlewares/auth.middleware') // Middleware xác thực JWT
const { ReportsRepository } = require('../repositories/ReportsRepository') // Repository reports
const { ReportsService } = require('../services/ReportsService') // Service reports
const { ReportsController } = require('../controllers/ReportsController') // Controller reports

const router = express.Router() // Tạo router

// Khởi tạo các lớp theo Service/Repository pattern
const reportsRepository = new ReportsRepository({ sequelize }) // Inject sequelize
const reportsService = new ReportsService({ reportsRepository }) // Inject repo
const reportsController = new ReportsController({ reportsService }) // Inject service

// Bảo vệ route theo yêu cầu: phải đăng nhập mới xem/gửi report
router.use(verifyToken) // Nếu token lỗi -> 401 ngay, tránh leak data

// GET list reports
router.get('/reports', reportsController.list)

// POST create report
router.post('/reports', reportsController.create)

module.exports = { reportsRouter: router } // Export router

