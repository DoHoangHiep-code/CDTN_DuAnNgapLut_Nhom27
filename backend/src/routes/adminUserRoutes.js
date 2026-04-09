const express = require('express') // Import express để tạo router
const { verifyToken, isAdmin } = require('../middlewares/auth.middleware') // Middleware xác thực + kiểm tra quyền admin
const { AdminUserController } = require('../controllers/AdminUserController') // Controller admin user

const router = express.Router() // Router cho /api/v1/admin/users
const controller = new AdminUserController() // Khởi tạo controller

// Bảo vệ toàn bộ route bằng verifyToken + isAdmin để ngăn truy cập trái phép
router.use(verifyToken) // Bắt buộc có JWT hợp lệ
router.use(isAdmin) // Bắt buộc role admin

// GET list users
router.get('/admin/users', controller.list)

// POST create user
router.post('/admin/users', controller.create)

// PUT update user
router.put('/admin/users/:id', controller.update)

// DELETE user
router.delete('/admin/users/:id', controller.remove)

module.exports = { adminUserRouter: router } // Export để server mount

