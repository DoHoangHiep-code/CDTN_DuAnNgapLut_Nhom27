const { AuthService } = require('../services/AuthService') // Import service để controller chỉ làm nhiệm vụ nhận request/response

class AuthController {
  constructor() {
    // Khởi tạo service (có thể thay bằng DI container sau nếu cần)
    this.authService = new AuthService()

    // Bind this để tránh mất context khi truyền handler vào router
    this.register = this.register.bind(this)
    this.login = this.login.bind(this)
    this.logout = this.logout.bind(this)
    this.forgotPassword = this.forgotPassword.bind(this)
    this.resetPassword = this.resetPassword.bind(this)
  }

  // POST /register
  async register(req, res, next) {
    try {
      // Lấy dữ liệu từ body
      const { username, email, password, full_name } = req.body

      // Validate tối thiểu để tránh insert rác + giảm lỗi DB
      // Lưu ý: UI frontend chỉ yêu cầu Name/Email/Password, nên username có thể không gửi.
      // Để UX tốt, backend sẽ tự sinh username từ email (phần trước dấu @) nếu thiếu.
      if (!email || !password || !full_name) {
        return res.status(400).json({ success: false, error: { message: 'Thiếu thông tin đăng ký' } })
      }

      // Gọi service đăng ký (service tự ép role='user')
      const derivedUsername = username || String(email).split('@')[0] || email
      const result = await this.authService.register({ username: derivedUsername, email, password, full_name })

      // Trả về kết quả (không gồm password)
      return res.status(201).json({ success: true, message: result.message, data: result.user })
    } catch (err) {
      // Đẩy lỗi cho global error handler để tập trung xử lý
      return next(err)
    }
  }

  // POST /login
  async login(req, res, next) {
    try {
      // Nhận username/email và password
      const usernameOrEmail = req.body.email || req.body.username || req.body.usernameOrEmail
      const password = req.body.password

      // Strict error messages theo yêu cầu
      if (!usernameOrEmail) return res.status(400).json({ success: false, error: { message: 'Vui lòng nhập tên đăng nhập!' } })
      if (!password) return res.status(400).json({ success: false, error: { message: 'Vui lòng nhập mật khẩu!' } })

      // Gọi service login
      const { token, user } = await this.authService.login({ usernameOrEmail, password })

      // Trả token + user
      return res.status(200).json({ success: true, data: { token, user } })
    } catch (err) {
      // Nếu service gắn statusCode thì dùng, không thì để global handler 500
      if (err && err.statusCode) return res.status(err.statusCode).json({ success: false, error: { message: err.message } })
      return next(err)
    }
  }

  // POST /logout
  async logout(_req, res, next) {
    try {
      // Stateless JWT: chỉ trả message để client xóa token
      const result = await this.authService.logout()
      return res.status(200).json({ success: true, message: result.message })
    } catch (err) {
      return next(err)
    }
  }

  // POST /forgot-password
  async forgotPassword(req, res, next) {
    try {
      // Lấy email từ body
      const { email } = req.body

      // Validate email để tránh spam request rỗng
      if (!email) return res.status(400).json({ success: false, error: { message: 'Thiếu email' } })

      // Gọi service tạo resetToken và log link ra console
      const result = await this.authService.forgotPassword({ email })

      // Trả message thành công (không leak email tồn tại hay không)
      return res.status(200).json({ success: true, message: result.message })
    } catch (err) {
      return next(err)
    }
  }

  // POST /reset-password
  async resetPassword(req, res, next) {
    try {
      // Token có thể đến từ query hoặc body theo yêu cầu
      const token = req.body.token || req.query.token
      const newPassword = req.body.newPassword

      // Validate đầu vào để tránh lỗi verify
      if (!token) return res.status(400).json({ success: false, error: { message: 'Thiếu token' } })
      if (!newPassword) return res.status(400).json({ success: false, error: { message: 'Thiếu mật khẩu mới' } })

      // Gọi service reset password
      const result = await this.authService.resetPassword({ token, newPassword })

      // Trả message thành công
      return res.status(200).json({ success: true, message: result.message })
    } catch (err) {
      // Token hết hạn/sai chữ ký -> 401 để client xử lý
      if (err && (err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError')) {
        return res.status(401).json({ success: false, error: { message: 'Token hết hạn hoặc không hợp lệ' } })
      }
      if (err && err.statusCode) return res.status(err.statusCode).json({ success: false, error: { message: err.message } })
      return next(err)
    }
  }
}

module.exports = { AuthController }

