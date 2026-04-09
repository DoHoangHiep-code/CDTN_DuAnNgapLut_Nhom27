const bcrypt = require('bcryptjs') // Dùng bcryptjs để hash/compare mật khẩu an toàn
const jwt = require('jsonwebtoken') // Dùng JWT để phát hành token đăng nhập / reset password
const { User } = require('../models') // Import model User để thao tác DB bằng Sequelize
const { JWT_SECRET } = require('../middlewares/auth.middleware') // Dùng chung secret để verify/issue JWT

// Hàm helper: loại bỏ các trường nhạy cảm trước khi trả về client (tránh lộ password_hash)
function sanitizeUser(userInstance) {
  // Nếu không có user thì trả null để xử lý empty-state
  if (!userInstance) return null

  // Chuyển Sequelize instance -> plain object để thao tác dễ hơn
  const u = userInstance.get ? userInstance.get({ plain: true }) : userInstance

  // Xóa trường password_hash để tránh lộ hash ra ngoài (hash vẫn là thông tin nhạy cảm)
  delete u.password_hash

  // Trả object an toàn
  return u
}

class AuthService {
  // Đăng ký tài khoản: luôn ép role='user' để chống user tự nâng quyền (privilege escalation)
  async register({ username, email, password, full_name }) {
    // Hash mật khẩu trước khi lưu DB để dù DB bị leak cũng không lộ mật khẩu plaintext
    const password_hash = await bcrypt.hash(password, 10) // Cost 10 cân bằng giữa bảo mật và hiệu năng

    // Tạo user mới, bỏ qua role từ body bằng cách set cứng role='user'
    const created = await User.create({
      username,
      email,
      full_name,
      password_hash,
      role: 'user', // CRITICAL: ép role user
      avatar_url: null, // Mặc định chưa có avatar
    })

    // Trả về user đã được sanitize
    return { user: sanitizeUser(created), message: 'Đăng ký thành công' }
  }

  // Đăng nhập: kiểm tra username/email + password, phát JWT 24h
  async login({ usernameOrEmail, password }) {
    // Tìm user theo username hoặc email để linh hoạt, nhưng vẫn giữ thông báo lỗi theo yêu cầu
    const user = await User.findOne({
      where: {
        // Ưu tiên match username hoặc email
        // Sequelize sẽ tạo OR query; cách viết này tránh raw SQL injection
        [require('sequelize').Op.or]: [{ username: usernameOrEmail }, { email: usernameOrEmail }],
      },
    })

    // Nếu không tìm thấy user thì trả đúng thông báo yêu cầu (không leak thêm info)
    if (!user) {
      const err = new Error('Tài khoản không tồn tại') // Thông báo theo yêu cầu
      err.statusCode = 401 // Đặt statusCode để controller/global handler dùng
      throw err
    }

    // Compare mật khẩu với hash trong DB (constant-time so với tự so string)
    const ok = await bcrypt.compare(password, user.password_hash)

    // Nếu sai password thì trả đúng thông báo yêu cầu
    if (!ok) {
      const err = new Error('Mật khẩu không chính xác')
      err.statusCode = 401
      throw err
    }

    // Tạo JWT payload tối thiểu (principle of least privilege) để hạn chế lộ thông tin
    const payload = { user_id: user.user_id, role: user.role, username: user.username, email: user.email }

    // Issue access token 24h theo yêu cầu
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' })

    // Trả token + user (không trả password_hash)
    return { token, user: sanitizeUser(user) }
  }

  // Logout: backend stateless JWT -> chỉ hướng dẫn client xóa token
  async logout() {
    // Vì JWT stateless, server không “xóa” token trừ khi có blacklist/rotation (không yêu cầu)
    return { message: 'Đăng xuất thành công. Vui lòng xóa JWT token phía client.' }
  }

  // Forgot password: tạo resetToken JWT 15 phút, mock email bằng console.log
  async forgotPassword({ email }) {
    // Tìm user theo email để đảm bảo đúng flow reset theo mail
    const user = await User.findOne({ where: { email } })

    // Nếu không tìm thấy user: vẫn trả success message chung để tránh email enumeration (an toàn hơn)
    if (!user) {
      return { message: 'Nếu email tồn tại, hệ thống đã gửi link đặt lại mật khẩu.' }
    }

    // Payload chỉ chứa user_id để tối thiểu quyền và giảm rủi ro token bị lộ
    const payload = { user_id: user.user_id, purpose: 'reset_password' }

    // Token chỉ sống 15 phút để giảm rủi ro bị lộ link
    const resetToken = jwt.sign(payload, JWT_SECRET, { expiresIn: '15m' })

    // DEV MOCK: log link ra terminal để test, không dùng SMTP thật
    const link = `http://localhost:3000/reset-password?token=${resetToken}`
    console.log('[DEV] Reset password link:', link)

    // Trả message thành công cho frontend
    return { message: 'Vui lòng kiểm tra email để đặt lại mật khẩu (DEV: link được in ra terminal).' }
  }

  // Reset password: verify token 15 phút và cập nhật password_hash
  async resetPassword({ token, newPassword }) {
    // Verify token để đảm bảo token hợp lệ và còn hạn (exp)
    const decoded = jwt.verify(token, JWT_SECRET) // Nếu fail sẽ throw

    // Kiểm tra purpose để chống reuse token sai mục đích (defense-in-depth)
    if (decoded.purpose !== 'reset_password') {
      const err = new Error('Token reset không hợp lệ')
      err.statusCode = 401
      throw err
    }

    // Hash mật khẩu mới trước khi lưu
    const password_hash = await bcrypt.hash(newPassword, 10)

    // Update DB theo user_id trong token (không tin tưởng user_id từ body)
    const [updated] = await User.update(
      { password_hash },
      { where: { user_id: decoded.user_id } },
    )

    // Nếu không update được (user bị xóa) thì trả lỗi nhẹ
    if (!updated) {
      const err = new Error('Tài khoản không tồn tại')
      err.statusCode = 404
      throw err
    }

    // Trả message thành công
    return { message: 'Đặt lại mật khẩu thành công' }
  }
}

module.exports = { AuthService, sanitizeUser }

