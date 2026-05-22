const path = require('path') // Dùng để xử lý đường dẫn file an toàn trên mọi OS
const bcrypt = require('bcryptjs') // Dùng bcryptjs để hash/compare mật khẩu
const { User } = require('../models') // Import model User để đọc/cập nhật profile
const { sanitizeUser } = require('./AuthService') // Reuse hàm sanitize để tránh lộ password_hash

class ProfileService {
  // Lấy thông tin user hiện tại theo user_id trong JWT
  async getProfile({ userId }) {
    // Query DB để lấy dữ liệu mới nhất (không tin tưởng payload JWT cho profile chi tiết)
    const user = await User.findByPk(userId)
    // Nếu không tìm thấy thì trả null để controller xử lý
    if (!user) return null
    // Trả user đã sanitize
    return sanitizeUser(user)
  }

  // Update full_name: không cho update role/email để tránh user tự nâng quyền hoặc chiếm email
  async updateProfile({ userId, full_name }) {
    // Update có điều kiện theo user_id để tránh cập nhật sai người
    const [updated] = await User.update({ full_name }, { where: { user_id: userId } })
    // Nếu không update được (user không tồn tại) thì trả null
    if (!updated) return null
    // Lấy lại record sau update để trả client
    const user = await User.findByPk(userId)
    return sanitizeUser(user)
  }

  // Update avatar_url sau khi multer lưu file
  async updateAvatar({ userId, filename }) {
    // Tạo url public tương đối để frontend load (không trả đường dẫn tuyệt đối của server)
    const avatar_url = path.posix.join('/uploads/avatars', filename) // Dùng posix để url luôn dùng '/'
    // Update DB
    const [updated] = await User.update({ avatar_url }, { where: { user_id: userId } })
    // Nếu user không tồn tại thì trả null
    if (!updated) return null
    // Trả avatar_url mới
    return { avatar_url }
  }

  // Đổi mật khẩu
  async changePassword({ userId, currentPassword, newPassword }) {
    const user = await User.findByPk(userId)
    if (!user) {
      const err = new Error('Tài khoản không tồn tại')
      err.statusCode = 404
      throw err
    }
    const ok = await bcrypt.compare(currentPassword, user.password_hash)
    if (!ok) {
      const err = new Error('Mật khẩu hiện tại không chính xác')
      err.statusCode = 400
      throw err
    }
    const password_hash = await bcrypt.hash(newPassword, 10)
    await User.update({ password_hash }, { where: { user_id: userId } })
    return { message: 'Đổi mật khẩu thành công' }
  }
}

module.exports = { ProfileService }

