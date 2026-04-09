const { AdminUserService } = require('../services/AdminUserService') // Import service để controller mỏng, chỉ xử lý HTTP

class AdminUserController {
  constructor() {
    // Khởi tạo service quản trị user
    this.adminUserService = new AdminUserService()

    // Bind để tránh mất context this khi truyền hàm vào router
    this.list = this.list.bind(this)
    this.create = this.create.bind(this)
    this.update = this.update.bind(this)
    this.remove = this.remove.bind(this)
  }

  // GET /api/v1/admin/users
  async list(req, res, next) {
    try {
      // Query params cho search/filter
      // - q: search theo full_name/email
      // - role: all/admin/expert/user
      const q = typeof req.query.q === 'string' ? req.query.q : ''
      const role = typeof req.query.role === 'string' ? req.query.role : 'all'

      // Lấy danh sách users (đã sanitize, không có password_hash)
      const users = await this.adminUserService.listUsers({ q, role })
      // Trả kết quả
      return res.status(200).json({ success: true, data: users })
    } catch (err) {
      // Đẩy lỗi cho global error handler
      return next(err)
    }
  }

  // POST /api/v1/admin/users
  async create(req, res, next) {
    try {
      // Nhận dữ liệu từ body
      const { username, email, password, full_name, role } = req.body

      // Validate đầu vào (giảm lỗi DB và tránh tạo user thiếu dữ liệu)
      if (!username || !email || !password || !full_name || !role) {
        return res.status(400).json({ success: false, error: { message: 'Thiếu thông tin tạo user' } })
      }

      // Tạo user mới (admin được set role)
      const user = await this.adminUserService.createUser({ username, email, password, full_name, role })

      // Trả về user mới
      return res.status(201).json({ success: true, data: user })
    } catch (err) {
      // Đẩy lỗi
      if (err && err.statusCode) return res.status(err.statusCode).json({ success: false, error: { message: err.message } })
      return next(err)
    }
  }

  // PUT /api/v1/admin/users/:id
  async update(req, res, next) {
    try {
      // Admin user_id từ JWT (verifyToken đã set req.user)
      const adminUserId = req.user.user_id

      // Target user id từ params
      const targetUserId = Number(req.params.id)

      // Validate id hợp lệ để tránh query sai
      if (!Number.isFinite(targetUserId)) {
        return res.status(400).json({ success: false, error: { message: 'ID không hợp lệ' } })
      }

      // Patch payload (cho phép update các field cơ bản + role)
      const patch = req.body || {}

      // Update user (service có chặn self-demotion)
      const updated = await this.adminUserService.updateUser({ adminUserId, targetUserId, patch })

      // Nếu user không tồn tại
      if (!updated) return res.status(404).json({ success: false, error: { message: 'Không tìm thấy người dùng' } })

      // Trả data
      return res.status(200).json({ success: true, data: updated })
    } catch (err) {
      // Trả lỗi có statusCode (self-demotion) hoặc đẩy global handler
      if (err && err.statusCode) return res.status(err.statusCode).json({ success: false, error: { message: err.message } })
      return next(err)
    }
  }

  // DELETE /api/v1/admin/users/:id
  async remove(req, res, next) {
    try {
      // Admin user_id từ JWT
      const adminUserId = req.user.user_id

      // Target id từ params
      const targetUserId = Number(req.params.id)

      // Validate
      if (!Number.isFinite(targetUserId)) {
        return res.status(400).json({ success: false, error: { message: 'ID không hợp lệ' } })
      }

      // Delete user (service có chặn self-deletion)
      const ok = await this.adminUserService.deleteUser({ adminUserId, targetUserId })

      // Nếu không xóa được (không tồn tại) thì 404
      if (!ok) return res.status(404).json({ success: false, error: { message: 'Không tìm thấy người dùng' } })

      // Trả success
      return res.status(200).json({ success: true, message: 'Xóa user thành công' })
    } catch (err) {
      // Trả lỗi có statusCode hoặc đẩy global
      if (err && err.statusCode) return res.status(err.statusCode).json({ success: false, error: { message: err.message } })
      return next(err)
    }
  }
}

module.exports = { AdminUserController }

