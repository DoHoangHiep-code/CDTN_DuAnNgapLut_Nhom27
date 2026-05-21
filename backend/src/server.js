require('dotenv').config() // Load .env trước tất cả (phải đứng đầu file)

const express = require('express') // Import Express để tạo HTTP server
const cors = require('cors')       // Import CORS để cho phép frontend gọi API khác port
const path = require('path')       // Import path để build đường dẫn static an toàn

const { dashboardRouter }      = require('./modules/flood/routes/dashboardRoutes')      // Router dashboard
const { mapRouter }            = require('./modules/flood/routes/mapRoutes')             // Router flood map
const { weatherRouter }        = require('./modules/flood/routes/weatherRoutes')         // Router weather
const { authRouter }           = require('./routes/authRoutes')            // Router auth
const { profileRouter }        = require('./routes/profileRoutes')         // Router profile
const { adminUserRouter }      = require('./routes/adminUserRoutes')       // Router admin CRUD users
const { systemLogRouter }      = require('./routes/systemLogRoutes')       // Router system logs
const { reportsRouter }        = require('./modules/flood/routes/reportsRoutes')         // Router reports
const { floodPredictionRouter} = require('./modules/flood/routes/floodPredictionRoutes') // Router compat /flood-prediction
const { unifiedChatbotRouter } = require('./routes/unifiedChatbotRoutes') // Router chatbot AI (unified)
const { healthCheckRouter }    = require('./routes/healthCheckRoutes')     // Router health-check cloud
const { landslideRouter }      = require('./modules/landslide/routes/landslideRoutes') // Router landslide prediction
const { initLandslideModel }   = require('./modules/landslide/services/landslideInference') // ONNX model init
const { statisticsRouter }     = require('./routes/statisticsRoutes')      // Router statistics
const { alertsRouter }         = require('./modules/flood/routes/alertsRoutes')           // Router alerts/banner
const { sequelize }            = require('./db/sequelize')                 // Sequelize instance để sync/auth
const { Pool }                 = require('pg')                             // Pool instance cho raw query
const landslideCache           = require('./utils/landslideCache')         // Landslide fast cache
require('./models') // Nạp toàn bộ model trước sync để Sequelize biết cần tạo/alter bảng nào

// ── Weather & Backup & Flood Prediction Cronjobs ─────────────────────────────
const { startWeatherCron, manualTrigger } = require('./modules/flood/cron/weatherCron')
const { startBackupCron }                 = require('./common/services/backupCron')
const { startFloodPredictionCron }        = require('./modules/flood/cron/floodPredictionCron')
const { startLandslideCron }              = require('./modules/landslide/cron/landslideCron')

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
app.use('/api/v1', unifiedChatbotRouter)
app.use('/api/v1', healthCheckRouter)
app.use('/api/v1/auth', authRouter)
app.use('/api/v1', profileRouter)
app.use('/api/v1', adminUserRouter)
app.use('/api/v1', systemLogRouter)
app.use('/api/v1', alertsRouter)
app.use('/api/v1/landslide', landslideRouter)  // Landslide prediction ONNX

// ── Route kích hoạt Cronjob thủ công (CHỈ dùng khi dev/test) ────────────────
// QUAN TRỌNG: Phải đặt TRƯỚC reportsRouter vì router.use(verifyToken) bên trong
// reportsRouter sẽ chặn mọi request không có token (kể cả /cron/trigger).
// Gọi: GET http://localhost:3002/api/v1/cron/trigger
app.get('/api/v1/cron/trigger', (_req, res) => {
  res.json({ success: true, message: 'WeatherCron đang chạy ở background, kiểm tra console để xem tiến độ.' })
  // Fire-and-forget: trả 200 ngay, cron chạy async
  manualTrigger().catch((err) => console.error('[CronTrigger] Lỗi:', err))
})

app.use('/api/v1', statisticsRouter)
app.use('/api/v1', reportsRouter)

// ── Serve static uploads ─────────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')))

// ── Global error handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = Number(err?.statusCode) || 500
  const message = err instanceof Error ? err.message : 'Unknown error'
  return res.status(status).json({ success: false, error: { message } })
})

// ── Khởi động server (có bootstrap DB cloud) ────────────────────────────────
const port = Number(process.env.PORT || 3002)

async function bootstrapAndStart() {
  try {
    // 1) Kiểm tra kết nối DB trước khi start server để fail-fast khi cấu hình sai.
    await sequelize.authenticate()
    console.log('[DB] Kết nối thành công.')

    // 1.5) Khởi tạo ONNX Model Sạt lở (load 1 lần vào RAM)
    try {
      await initLandslideModel()
    } catch (modelErr) {
      // Không crash server nếu model chưa được copy vào — chỉ cảnh báo
      console.warn('[Bootstrap] ⚠️  Landslide ONNX model không load được:', modelErr.message)
      console.warn('[Bootstrap]    → Endpoint /api/v1/landslide/predict sẽ trả 503 cho đến khi model được cài.')
    }

    // 1.1) PostGIS đã được khởi tạo qua Migration 001. Không chạy ở đây để tránh lỗi read-only transaction.
    console.log('[DB] PostGIS đã được setup qua Migration.')

    // 1.2) Pre-warm cache cho Landslide để API /nodes phản hồi nhanh (<300ms)
    try {
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
      })
      // Không await để server không bị block startup (có thể mất 1-60s tùy DB)
      landslideCache.prewarmFromDb(pool).finally(() => pool.end())
    } catch (cacheErr) {
      console.warn('[Bootstrap] ⚠️ Khởi động cache prewarm lỗi:', cacheErr.message)
    }

    // 2) Tự đồng bộ schema: tạo bảng mới + điều chỉnh cột khi khác biệt.
    // Lưu ý: alter=true tiện cho môi trường dev/staging; production lớn nên cân nhắc migration chuẩn.
    // await sequelize.sync({ alter: true })
    console.log('[DB] Đã bỏ qua sequelize.sync do quản lý bằng Migrations.')

    // 3) Chỉ listen khi DB đã sẵn sàng.
    const server = app.listen(port, () => {
      console.log(`Backend listening on :${port}`)

      // Đăng ký Cronjobs sau khi server đã listen thành công
      // → tránh cron chạy trước khi DB connection sẵn sàng
      startWeatherCron()           // Mỗi 1 giờ: lấy OWM forecast + ghi flood_predictions
      startBackupCron()            // Ngày 1 hàng tháng: backup CSV + xóa data cũ
      startFloodPredictionCron()   // Mỗi 10 phút: cập nhật dự báo dựa trên thời tiết hiện tại
      startLandslideCron()         // 0h & 12h hàng ngày: batch predict sạt lở (425K nodes)
    })

    // Bắt lỗi EADDRINUSE riêng: in hướng dẫn kill port thay vì stack trace khó đọc
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[Bootstrap] Port ${port} đang bị chiếm dụng bởi tiến trình khác.`)
        console.error(`[Bootstrap] Chạy lệnh sau để giải phóng port:`)
        console.error(`  PowerShell: Stop-Process -Id (Get-NetTCPConnection -LocalPort ${port}).OwningProcess -Force`)
        console.error(`  CMD:        FOR /F "tokens=5" %p IN ('netstat -ano ^| findstr :${port}') DO taskkill /F /PID %p`)
      } else {
        console.error('[Bootstrap] Lỗi server không xử lý được:', err.message)
      }
      process.exit(1)
    })
  } catch (err) {
    // Xử lý kỹ lỗi SSL/kết nối CockroachDB để dễ debug trên cloud.
    const message = err instanceof Error ? err.message : 'Unknown bootstrap error'
    console.error('[Bootstrap] Không thể khởi động server:', message)
    if (String(message).toLowerCase().includes('ssl')) {
      console.error('[Bootstrap] Gợi ý: kiểm tra DATABASE_URL và dialectOptions.ssl trong Sequelize.')
    }
    process.exit(1)
  }
}

bootstrapAndStart()
