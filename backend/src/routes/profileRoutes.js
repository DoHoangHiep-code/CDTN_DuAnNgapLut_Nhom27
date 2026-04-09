const express = require('express') // Import express để tạo router
const { verifyToken } = require('../middlewares/auth.middleware') // Middleware xác thực JWT
const { ProfileController, uploadAvatarMiddleware } = require('../controllers/ProfileController') // Controller + multer middleware

const router = express.Router() // Router cho /api/v1/users/profile
const controller = new ProfileController() // Khởi tạo controller

// GET profile: yêu cầu đăng nhập
router.get('/users/profile', verifyToken, controller.getProfile)

// PUT profile: chỉ update full_name, yêu cầu đăng nhập
router.put('/users/profile', verifyToken, controller.updateProfile)

// POST avatar: upload file an toàn bằng multer, yêu cầu đăng nhập
router.post('/users/profile/avatar', verifyToken, uploadAvatarMiddleware, controller.uploadAvatar)

module.exports = { profileRouter: router } // Export để server mount

