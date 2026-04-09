const bcrypt = require('bcryptjs') // Hash mật khẩu khi tạo/cập nhật user
const { sanitizeUser } = require('./AuthService') // Loại bỏ password_hash khi trả về
const { AdminUserRepository } = require('../repositories/AdminUserRepository') // Tách DB access ra repository

class AdminUserService {
  constructor() {
    this.adminUserRepository = new AdminUserRepository()
  }

  // List toàn bộ users (admin only)
  async listUsers({ q, role }) {
    const users = await this.adminUserRepository.listUsers({ q, role })
    return users.map((u) => sanitizeUser(u)) // Không trả password_hash
  }

  // Tạo user mới: admin được set role explicit
  async createUser({ username, email, password, full_name, role }) {
    // Hash password để bảo mật
    const password_hash = await bcrypt.hash(password, 10)
    // Tạo user
    const created = await this.adminUserRepository.createUser({
      username,
      email,
      full_name,
      role,
      password_hash,
      avatar_url: null,
    })
    return sanitizeUser(created)
  }

  // Update user: admin đổi thông tin và role, nhưng cấm tự đổi role (tránh tự khóa quyền admin)
  async updateUser({ adminUserId, targetUserId, patch }) {
    // Nếu admin đang update chính mình và có ý định đổi role thì chặn (no self-role-change)
    if (Number(adminUserId) === Number(targetUserId) && patch.role != null) {
      const err = new Error('Không thể tự thay đổi role của chính mình')
      err.statusCode = 400
      throw err
    }

    // Chỉ cho phép update field whitelist để tránh mass assignment (bảo mật)
    const allowed = {}
    if (patch.username != null) allowed.username = patch.username
    if (patch.email != null) allowed.email = patch.email
    if (patch.full_name != null) allowed.full_name = patch.full_name
    if (patch.role != null) allowed.role = patch.role

    // Nếu admin cập nhật password (trong modal edit) thì luôn hash (CRITICAL)
    if (patch.password != null && String(patch.password).trim()) {
      allowed.password_hash = await bcrypt.hash(String(patch.password), 10)
    }

    // Update theo id
    const ok = await this.adminUserRepository.updateUser(targetUserId, allowed)
    if (!ok) return null

    const user = await this.adminUserRepository.findById(targetUserId)
    return sanitizeUser(user)
  }

  // Delete user: cấm admin tự xóa chính mình (no self-deletion)
  async deleteUser({ adminUserId, targetUserId }) {
    if (Number(adminUserId) === Number(targetUserId)) {
      const err = new Error('Không thể tự xóa tài khoản của chính mình')
      err.statusCode = 400
      throw err
    }
    return this.adminUserRepository.deleteUser(targetUserId)
  }
}

module.exports = { AdminUserService }

