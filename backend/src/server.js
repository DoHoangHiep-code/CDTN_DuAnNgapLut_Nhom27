const express = require('express') // Import Express để tạo HTTP server
const cors = require('cors') // Import CORS để cho phép frontend gọi API khác port (bị browser chặn nếu thiếu)
const path = require('path') // Import path để build đường dẫn static an toàn
const { dashboardRouter } = require('./routes/dashboardRoutes') // Router dashboard
const { mapRouter } = require('./routes/mapRoutes') // Router flood map
const { weatherRouter } = require('./routes/weatherRoutes') // Router weather
const { authRouter } = require('./routes/authRoutes') // Router auth
const { profileRouter } = require('./routes/profileRoutes') // Router profile
const { adminUserRouter } = require('./routes/adminUserRoutes') // Router admin CRUD users
const { reportsRouter } = require('./routes/reportsRoutes') // Router reports (actual_flood_reports)
const { floodPredictionRouter } = require('./routes/floodPredictionRoutes') // Router compat /flood-prediction

const app = express() // Khởi tạo app Express
// Bật CORS để frontend (Vite) gọi API mà không bị browser chặn (Same-Origin Policy)
app.use(
  cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'], // Cho phép Vite dev server
    credentials: false, // JWT dùng header Bearer nên không cần cookie
  }),
)
app.use(express.json()) // Parse JSON body (giới hạn/advanced có thể thêm sau để chống payload lớn)

app.get('/health', (_req, res) => res.json({ ok: true })) // Health check đơn giản

app.use('/api/v1', dashboardRouter) // Mount dashboard endpoints
app.use('/api/v1', mapRouter) // Mount flood map endpoints
app.use('/api/v1', weatherRouter) // Mount weather endpoints
app.use('/api/v1', floodPredictionRouter) // Mount endpoint compat để FE không bị 404
app.use('/api/v1/auth', authRouter) // Mount auth endpoints dưới /api/v1/auth/*
app.use('/api/v1', profileRouter) // Mount profile endpoints
app.use('/api/v1', adminUserRouter) // Mount admin endpoints
app.use('/api/v1', reportsRouter) // Mount reports endpoints

// Serve static uploads để client load avatar_url dạng /uploads/...
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads'))) // Cho phép truy cập file avatar qua URL

// Global error handler (keeps controllers thin; prevents leaking stack traces by default)
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = Number(err?.statusCode) || 500 // Ưu tiên statusCode nếu service chủ động set (vd: 400/401/403)
  const message = err instanceof Error ? err.message : 'Unknown error' // Không trả stack trace để giảm lộ nội bộ
  return res.status(status).json({ success: false, error: { message } }) // Format lỗi thống nhất
})

const port = Number(process.env.PORT || 3002) // Đọc port từ env để dễ deploy
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on :${port}`) // Log để debug khi chạy local
})

