const jwt = require('jsonwebtoken') // Import thư viện JWT để giải mã token

// Đọc JWT secret từ env, đồng bộ với auth.middleware.js
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me'

/**
 * Middleware optionalAuth:
 * - Nếu có header Authorization hợp lệ → giải mã và gán req.user (như verifyToken)
 * - Nếu KHÔNG có token hoặc token lỗi → BỎ QUA, KHÔNG trả 401, gán req.user = null
 *
 * Dùng cho các route cho phép cả user đăng nhập lẫn anonymous (ví dụ: gửi báo cáo ngập)
 * userId sẽ là null trong DB nếu người dùng chưa đăng nhập → vẫn lưu được báo cáo
 */
function optionalAuth(req, _res, next) {
  try {
    const authHeader = req.headers.authorization // Lấy header Authorization

    // Không có token → coi là anonymous, tiếp tục bình thường
    if (!authHeader) {
      req.user = null
      return next()
    }

    // Tách "Bearer <token>"
    const parts = authHeader.split(' ')
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      // Format sai → bỏ qua, không chặn
      req.user = null
      return next()
    }

    const token = parts[1]

    // Giải mã token; nếu hợp lệ thì gắn vào req.user
    const decoded = jwt.verify(token, JWT_SECRET)
    req.user = decoded // Payload chứa user_id, role, ...
  } catch {
    // Token hết hạn hoặc sai chữ ký → coi là anonymous (không chặn)
    req.user = null
  }

  return next()
}

module.exports = { optionalAuth }
