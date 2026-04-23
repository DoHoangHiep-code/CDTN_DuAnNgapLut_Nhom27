require('dotenv').config() // Load .env trước tất cả (phải đứng đầu file)

const express = require('express') // Import Express để tạo HTTP server
const cors    = require('cors')    // Import CORS để cho phép frontend gọi API khác port
const path    = require('path')    // Import path để build đường dẫn static an toàn

const { dashboardRouter }      = require('./routes/dashboardRoutes')      // Router dashboard
const { mapRouter }            = require('./routes/mapRoutes')             // Router flood map
const { weatherRouter }        = require('./routes/weatherRoutes')         // Router weather
const { authRouter }           = require('./routes/authRoutes')            // Router auth
const { profileRouter }        = require('./routes/profileRoutes')         // Router profile
const { adminUserRouter }      = require('./routes/adminUserRoutes')       // Router admin CRUD users
const { reportsRouter }        = require('./routes/reportsRoutes')         // Router reports
const { floodPredictionRouter} = require('./routes/floodPredictionRoutes') // Router compat /flood-prediction

// ── Weather Cronjob ──────────────────────────────────────────────────────────
// Import service cronjob dự báo ngập lụt mỗi 6 tiếng
const { startWeatherCron, manualTrigger } = require('./services/weatherCron')

const app = express() // Khởi tạo app Express

// Bật CORS để frontend (Vite) gọi API mà không bị browser chặn (Same-Origin Policy)
app.use(
  cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'], // Cho phép Vite dev server
    credentials: false, // JWT dùng header Bearer nên không cần cookie
  }),
)
app.use(express.json()) // Parse JSON body

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true }))

// ── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/v1', dashboardRouter)
app.use('/api/v1', mapRouter)
app.use('/api/v1', weatherRouter)
app.use('/api/v1', floodPredictionRouter)
app.use('/api/v1/auth', authRouter)
app.use('/api/v1', profileRouter)
app.use('/api/v1', adminUserRouter)

// ── Route kích hoạt Cronjob thủ công (CHỈ dùng khi dev/test) ────────────────
// QUAN TRỌNG: Phải đặt TRƯỚC reportsRouter vì router.use(verifyToken) bên trong
// reportsRouter sẽ chặn mọi request không có token (kể cả /cron/trigger).
// Gọi: GET http://localhost:3002/api/v1/cron/trigger
app.get('/api/v1/cron/trigger', (_req, res) => {
  res.json({ success: true, message: 'WeatherCron đang chạy ở background, kiểm tra console để xem tiến độ.' })
  // Fire-and-forget: trả 200 ngay, cron chạy async
  manualTrigger().catch((err) => console.error('[CronTrigger] Lỗi:', err))
})

app.use('/api/v1', reportsRouter)

// ── Serve static uploads ─────────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')))

// ── Global error handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status  = Number(err?.statusCode) || 500
  const message = err instanceof Error ? err.message : 'Unknown error'
  return res.status(status).json({ success: false, error: { message } })
})

// ── Khởi động server ─────────────────────────────────────────────────────────
const port = Number(process.env.PORT || 3002)
app.listen(port, () => {
  console.log(`Backend listening on :${port}`)

  // Đăng ký Weather Cronjob sau khi server đã listen thành công
  // → tránh cron chạy trước khi DB connection sẵn sàng
  startWeatherCron()
})

