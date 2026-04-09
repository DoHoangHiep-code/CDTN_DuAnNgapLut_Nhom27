const path = require('path') // Dùng cho xử lý đường dẫn upload
const fs = require('fs') // Dùng để tạo thư mục upload nếu chưa có
const multer = require('multer') // Multer để upload file an toàn
const { ProfileService } = require('../services/ProfileService') // Service profile

// Tạo thư mục upload nếu chưa tồn tại (tránh lỗi khi save file lần đầu)
const AVATAR_DIR = path.join(process.cwd(), 'uploads', 'avatars') // Lưu vào /uploads/avatars theo yêu cầu
if (!fs.existsSync(AVATAR_DIR)) fs.mkdirSync(AVATAR_DIR, { recursive: true }) // recursive để tạo đủ cây thư mục

// Cấu hình lưu file trên disk để dễ serve static (không lưu base64 trong DB)
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    // Lưu vào thư mục đã chuẩn bị
    cb(null, AVATAR_DIR)
  },
  filename: (_req, file, cb) => {
    // Đổi tên file để tránh trùng + giảm rủi ro path traversal
    const ext = path.extname(file.originalname).toLowerCase() // Lấy đuôi file
    const safeName = `avatar_${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}` // Unique name
    cb(null, safeName)
  },
})

// Filter file: chỉ cho png/jpg/jpeg để giảm rủi ro upload file độc hại (webshell/zip bomb)
function fileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase() // Đuôi file
  const allowed = ['.png', '.jpg', '.jpeg'] // Cho phép theo yêu cầu
  if (!allowed.includes(ext)) {
    return cb(new Error('Chỉ cho phép file .png, .jpg, .jpeg'), false) // Chặn ngay ở middleware
  }
  return cb(null, true) // Cho phép upload
}

// Giới hạn dung lượng 2MB để chống DoS upload file lớn
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
})

class ProfileController {
  constructor() {
    // Khởi tạo service
    this.profileService = new ProfileService()

    // Bind handlers
    this.getProfile = this.getProfile.bind(this)
    this.updateProfile = this.updateProfile.bind(this)
    this.uploadAvatar = this.uploadAvatar.bind(this)
  }

  // GET /api/v1/users/profile
  async getProfile(req, res, next) {
    try {
      // user_id lấy từ JWT (verifyToken đã set req.user)
      const userId = req.user.user_id
      // Gọi service lấy profile
      const profile = await this.profileService.getProfile({ userId })
      // Nếu không tồn tại thì trả 404
      if (!profile) return res.status(404).json({ success: false, error: { message: 'Không tìm thấy người dùng' } })
      // Trả data
      return res.status(200).json({ success: true, data: profile })
    } catch (err) {
      return next(err)
    }
  }

  // PUT /api/v1/users/profile
  async updateProfile(req, res, next) {
    try {
      // user_id từ JWT
      const userId = req.user.user_id
      // Chỉ cho update full_name theo yêu cầu
      const { full_name } = req.body
      // Validate input
      if (!full_name) return res.status(400).json({ success: false, error: { message: 'Thiếu full_name' } })
      // Update
      const updated = await this.profileService.updateProfile({ userId, full_name })
      // Nếu user không tồn tại
      if (!updated) return res.status(404).json({ success: false, error: { message: 'Không tìm thấy người dùng' } })
      // Trả data
      return res.status(200).json({ success: true, data: updated })
    } catch (err) {
      return next(err)
    }
  }

  // POST /api/v1/users/profile/avatar
  async uploadAvatar(req, res, next) {
    try {
      // Multer đã lưu file thành công, file info nằm ở req.file
      if (!req.file) return res.status(400).json({ success: false, error: { message: 'Thiếu file avatar' } })
      // user_id từ JWT
      const userId = req.user.user_id
      // Update DB với filename mới
      const result = await this.profileService.updateAvatar({ userId, filename: req.file.filename })
      // Nếu user không tồn tại
      if (!result) return res.status(404).json({ success: false, error: { message: 'Không tìm thấy người dùng' } })
      // Trả avatar_url
      return res.status(200).json({ success: true, data: result })
    } catch (err) {
      return next(err)
    }
  }
}

module.exports = { ProfileController, uploadAvatarMiddleware: upload.single('avatar') }

