const { Op } = require('sequelize') // Dùng Op để tạo điều kiện OR/LIKE an toàn (tránh SQL injection)
const { User } = require('../models') // Model User

class AdminUserRepository {
  // Query danh sách users có search/filter (phục vụ trang quản trị)
  async listUsers({ q, role }) {
    const where = {}

    // Search theo full_name hoặc email (yêu cầu: search by name/email)
    if (q && String(q).trim()) {
      const kw = `%${String(q).trim()}%`
      // iLike chỉ có trên Postgres, phù hợp hệ thống đang dùng PG/PostGIS
      where[Op.or] = [{ full_name: { [Op.iLike]: kw } }, { email: { [Op.iLike]: kw } }]
    }

    // Filter theo role nếu có (admin/expert/user)
    if (role && String(role).trim() && String(role).trim() !== 'all') {
      where.role = String(role).trim()
    }

    // Sort theo created_at mới nhất để admin dễ thấy user vừa tạo
    return User.findAll({ where, order: [['created_at', 'DESC']] })
  }

  async findById(userId) {
    return User.findByPk(userId)
  }

  async createUser(payload) {
    return User.create(payload)
  }

  async updateUser(userId, patch) {
    const [updated] = await User.update(patch, { where: { user_id: userId } })
    return Boolean(updated)
  }

  async deleteUser(userId) {
    const deleted = await User.destroy({ where: { user_id: userId } })
    return Boolean(deleted)
  }
}

module.exports = { AdminUserRepository }

