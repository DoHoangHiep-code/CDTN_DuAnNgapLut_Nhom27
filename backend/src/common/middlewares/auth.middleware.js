const jwt = require('jsonwebtoken') // Import thư viện JWT để xác thực token

// Đọc JWT secret từ biến môi trường để tránh hard-code trong source code (giảm rủi ro lộ secret khi push repo)
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me' // DEV fallback: phải đổi khi deploy thật

// Middleware: xác thực JWT từ header Authorization: Bearer <token>
function verifyToken(req, res, next) {
  try {
    // Lấy header Authorization để đọc token theo chuẩn Bearer
    const authHeader = req.headers.authorization // Ví dụ: "Bearer eyJ..."

    // Nếu không có header thì trả 401 để client biết cần đăng nhập
    if (!authHeader) return res.status(401).json({ success: false, error: { message: 'Thiếu token xác thực' } })

    // Tách token theo format "Bearer <token>" để tránh đọc nhầm dữ liệu
    const parts = authHeader.split(' ') // ["Bearer", "<token>"]

    // Kiểm tra format để chống các request sai chuẩn hoặc cố tình phá (robust)
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return res.status(401).json({ success: false, error: { message: 'Token không hợp lệ' } })
    }

    // Token nằm ở phần thứ 2
    const token = parts[1] // JWT string

    // Verify token để đảm bảo chữ ký hợp lệ và token chưa hết hạn (exp)
    const decoded = jwt.verify(token, JWT_SECRET) // Nếu sai sẽ throw

    // Gắn decoded payload vào req.user để các controller/service dùng (không cần query DB lại ngay lập tức)
    req.user = decoded // Payload nên chứa user_id, role, username/email tùy bạn cấp

    // Cho request đi tiếp qua middleware tiếp theo / controller
    return next()
  } catch (err) {
    // Nếu token hết hạn hoặc sai chữ ký thì trả 401 (không trả chi tiết nội bộ để giảm lộ thông tin)
    return res.status(401).json({ success: false, error: { message: 'Token hết hạn hoặc không hợp lệ' } })
  }
}

// Middleware: chỉ cho phép admin truy cập (phòng chống privilege escalation)
function isAdmin(req, res, next) {
  // Nếu verifyToken chưa chạy hoặc không set req.user thì chặn (defense-in-depth)
  if (!req.user) return res.status(401).json({ success: false, error: { message: 'Chưa xác thực' } })

  // Chỉ cho phép role === 'admin' theo yêu cầu
  if (req.user.role !== 'admin') return res.status(403).json({ success: false, error: { message: 'Không đủ quyền' } })

  // Đủ quyền thì đi tiếp
  return next()
}

module.exports = { verifyToken, isAdmin, JWT_SECRET } // Export để dùng trong routes/controllers

