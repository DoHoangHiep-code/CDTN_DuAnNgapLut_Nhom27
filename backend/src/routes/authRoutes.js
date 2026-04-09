const express = require('express') // Import express để tạo router
const { AuthController } = require('../controllers/AuthController') // Import controller auth

const router = express.Router() // Tạo router riêng cho /api/v1/auth
const controller = new AuthController() // Khởi tạo controller

// Đăng ký: hash password + ép role=user
router.post('/register', controller.register)

// Đăng nhập: kiểm tra password + phát JWT 24h
router.post('/login', controller.login)

// Đăng xuất: stateless JWT -> instruct client clear token
router.post('/logout', controller.logout)

// Quên mật khẩu: tạo resetToken 15 phút, mock gửi mail bằng console.log
router.post('/forgot-password', controller.forgotPassword)

// Reset mật khẩu: verify resetToken + update password_hash
router.post('/reset-password', controller.resetPassword)

module.exports = { authRouter: router } // Export để server.js mount

