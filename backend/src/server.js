require('dotenv').config()

const express = require('express')
const cors = require('cors')
const path = require('path')

const { dashboardRouter } = require('./routes/dashboardRoutes')
const { mapRouter } = require('./routes/mapRoutes')
const { weatherRouter } = require('./routes/weatherRoutes')
const { authRouter } = require('./routes/authRoutes')
const { profileRouter } = require('./routes/profileRoutes')
const { adminUserRouter } = require('./routes/adminUserRoutes')
const { reportsRouter } = require('./routes/reportsRoutes')
const { floodPredictionRouter } = require('./routes/floodPredictionRoutes')
const { chatbotRouter } = require('./routes/chatbotRoutes')
const { healthCheckRouter } = require('./routes/healthCheckRoutes')
const expertChatRoutes = require('./routes/expertChat.routes')

const { sequelize } = require('./db/sequelize')
require('./models')

const { startWeatherCron, manualTrigger } = require('./services/weatherCron')

const app = express()

app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: false,
}))

app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

app.use('/api/v1', dashboardRouter)
app.use('/api/v1', mapRouter)
app.use('/api/v1', weatherRouter)
app.use('/api/v1', floodPredictionRouter)
app.use('/api/v1', chatbotRouter)
app.use('/api/v1', healthCheckRouter)
app.use('/api/v1/auth', authRouter)
app.use('/api/v1', profileRouter)
app.use('/api/v1', adminUserRouter)

// Chatbot chuyên gia
app.use('/api/v1/chat', expertChatRoutes)

app.get('/api/v1/cron/trigger', (_req, res) => {
  res.json({
    success: true,
    message: 'WeatherCron đang chạy ở background, kiểm tra console để xem tiến độ.',
  })

  manualTrigger().catch((err) => {
    console.error('[CronTrigger] Lỗi:', err)
  })
})

// Đặt reportsRouter sau cron/chat để tránh verifyToken chặn nhầm route
app.use('/api/v1', reportsRouter)

app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')))

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = Number(err?.statusCode) || 500
  const message = err instanceof Error ? err.message : 'Unknown error'

  return res.status(status).json({
    success: false,
    error: { message },
  })
})

const port = Number(process.env.PORT || 3002)

async function bootstrapAndStart() {
  try {
    await sequelize.authenticate()
    console.log('[DB] Kết nối thành công.')

    // Không chạy CREATE EXTENSION ở đây nếu DB cloud/Aiven/Supabase đã setup bằng migration
    console.log('[DB] PostGIS đã được setup qua Migration.')

    // QUAN TRỌNG:
    // Không dùng sequelize.sync({ alter: true })
    // Vì alter enum rất dễ gây lỗi:
    // cannot cast type user_role to enum_users_role
    console.log('[DB] Đã bỏ qua sequelize.sync do quản lý bằng Migrations.')

    app.listen(port, () => {
      console.log(`Backend listening on :${port}`)
      startWeatherCron()
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown bootstrap error'
    console.error('[Bootstrap] Không thể khởi động server:', message)

    if (String(message).toLowerCase().includes('ssl')) {
      console.error('[Bootstrap] Gợi ý: kiểm tra DATABASE_URL và dialectOptions.ssl trong Sequelize.')
    }

    process.exit(1)
  }
}

bootstrapAndStart()