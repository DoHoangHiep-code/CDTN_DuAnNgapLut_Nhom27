/* eslint-disable no-console */
const bcrypt = require('bcryptjs')
const { sequelize } = require('../db/sequelize')
const {
  User,
  GridNode,
  WeatherMeasurement,
  FloodPrediction,
  ActualFloodReport,
  SystemLog,
} = require('../models')

function rand(min, max) {
  return Math.random() * (max - min) + min
}

function randInt(min, max) {
  return Math.floor(rand(min, max + 1))
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function pointGeom(lng, lat) {
  return { type: 'Point', coordinates: [lng, lat] }
}

function nowUtc() {
  return new Date()
}

async function truncateAll() {
  // Order doesn't matter with CASCADE
  await sequelize.query(`
    TRUNCATE TABLE
      system_logs,
      actual_flood_reports,
      flood_predictions,
      weather_measurements,
      grid_nodes,
      users
    RESTART IDENTITY CASCADE;
  `)
}

async function seedUsers() {
  // Vì AuthService.login dùng bcrypt.compare(), nên password_hash trong seed bắt buộc phải là bcrypt hash thật.
  // Nếu để chuỗi "mock_hash_*" thì compare sẽ luôn fail => bạn đăng nhập seed user sẽ luôn thất bại.
  const adminHash = await bcrypt.hash('Admin@123', 10)
  const expertHash = await bcrypt.hash('Expert@123', 10)
  const userHash = await bcrypt.hash('User@123', 10)

  const users = await User.bulkCreate(
    [
      {
        username: 'admin',
        password_hash: adminHash,
        email: 'admin@fps.local',
        full_name: 'Admin User',
        avatar_url: null,
        role: 'admin',
      },
      {
        username: 'expert',
        password_hash: expertHash,
        email: 'expert@fps.local',
        full_name: 'Flood Expert',
        avatar_url: null,
        role: 'expert',
      },
      {
        username: 'user',
        password_hash: userHash,
        email: 'user@fps.local',
        full_name: 'Standard User',
        avatar_url: null,
        role: 'user',
      },
    ],
    { returning: true },
  )
  return users
}

async function seedGridNodes() {
  const hotspots = [
    { lat: 21.0253, lng: 105.8435 }, // Phan Bội Châu - Lý Thường Kiệt
    { lat: 21.0118, lng: 105.8201 }, // Ngã tư Tây Sơn - Thái Hà
    { lat: 21.0310, lng: 105.7992 }, // Phố Hoa Bằng
    { lat: 21.0298, lng: 105.8385 }, // Nguyễn Khuyến - Cổng trường Lý Thường Kiệt
    { lat: 21.0428, lng: 105.8285 }, // Thụy Khuê - Dốc La Pho
    { lat: 20.9997, lng: 105.8675 }, // Minh Khai - Chân cầu Vĩnh Tuy
    { lat: 20.9952, lng: 105.8115 }, // Nguyễn Trãi - Trước ĐH KHXH&NV
    { lat: 21.0025, lng: 105.7465 }, // Đại lộ Thăng Long - Ngã ba Lê Trọng Tấn
    { lat: 21.0445, lng: 105.8755 }, // Ngọc Lâm - Long Biên 1
    { lat: 21.0555, lng: 105.7825 }, // Phạm Văn Đồng - Ngã ba Xuân Đỉnh
    { lat: 20.9845, lng: 105.8423 }, // Giải Phóng - Bến xe Giáp Bát
    { lat: 20.9912, lng: 105.7952 }, // Phùng Khoang
    { lat: 21.1416, lng: 105.8973 }, // Xã Thư Lâm
  ]

  const nodes = hotspots.map((pt, index) => ({
    node_id: 100000 + index + 1,
    latitude: pt.lat,
    longitude: pt.lng,
    elevation: Number(rand(0, 25).toFixed(2)),
    slope: Number(rand(0, 10).toFixed(2)),
    impervious_ratio: Number(rand(0.05, 0.95).toFixed(3)),
    geom: pointGeom(pt.lng, pt.lat),
  }))

  await GridNode.bulkCreate(nodes)
  return nodes
}

async function seedWeatherMeasurements(nodeIds) {
  const base = nowUtc()
  const rows = []
  for (let i = 0; i < 500; i++) {
    const node_id = pick(nodeIds)
    const minutesAgo = randInt(0, 24 * 60)
    const time = new Date(base.getTime() - minutesAgo * 60 * 1000)
    const prcp    = Number(Math.max(0, rand(0, 40)).toFixed(2))
    const prcp_3h = Number((prcp * rand(1.5, 3.5)).toFixed(2))
    const prcp_6h = Number((prcp_3h * rand(1.2, 2.0)).toFixed(2))
    const prcp_12h = Number((prcp_6h * rand(1.1, 1.8)).toFixed(2))
    const prcp_24h = Number((prcp_12h * rand(1.1, 2.0)).toFixed(2))
    rows.push({
      node_id,
      time,
      temp:    Number(rand(22, 36).toFixed(2)),
      rhum:    Number(rand(45, 98).toFixed(2)),
      wspd:    Number(rand(0, 35).toFixed(2)),
      pres:    Number(rand(1000, 1020).toFixed(1)),
      prcp,
      prcp_3h,
      prcp_6h,
      prcp_12h,
      prcp_24h,
    })
  }
  await WeatherMeasurement.bulkCreate(rows)
}

function riskFromDepth(depthCm) {
  if (depthCm >= 50) return 'severe'
  if (depthCm >= 20) return 'high'
  if (depthCm >= 5) return 'medium'
  return 'safe'
}

async function seedFloodPredictions(nodeIds) {
  const base = nowUtc()
  const rows = []
  for (let i = 0; i < 100; i++) {
    const node_id = pick(nodeIds)
    const minutesAhead = randInt(0, 24 * 60)
    const time = new Date(base.getTime() + minutesAhead * 60 * 1000)
    const depth = Number(Math.max(0, rand(-1, 80)).toFixed(2))
    rows.push({
      node_id,
      time,
      flood_depth_cm: depth,
      risk_level: riskFromDepth(depth),
    })
  }
  await FloodPrediction.bulkCreate(rows)
}

async function seedActualFloodReports(users, gridNodes) {
  const base = nowUtc()
  const levels = ['Khô ráo', '<15cm', '15-30cm', '>30cm']

  const rows = []
  for (let i = 0; i < 10; i++) {
    const u = Math.random() < 0.8 ? pick(users) : null
    const node = pick(gridNodes)
    const minutesAgo = randInt(0, 6 * 60)
    const created_at = new Date(base.getTime() - minutesAgo * 60 * 1000)
    const level = pick(levels)
    const lat = Number(node.latitude)
    const lng = Number(node.longitude)
    rows.push({
      user_id: u ? u.user_id : null,
      latitude: lat,
      longitude: lng,
      geom: pointGeom(lng, lat),
      reported_level: level,
      created_at,
    })
  }
  await ActualFloodReport.bulkCreate(rows)
}

async function seedSystemLogs(adminUser) {
  await SystemLog.bulkCreate([
    {
      admin_id: adminUser?.user_id ?? null,
      event_type: 'seed',
      event_source: 'cli',
      message: 'Database seeded with mock data',
      timestamp: new Date(),
    },
  ])
}

async function main() {
  const started = Date.now()
  try {
    await sequelize.authenticate()
    console.log('DB connected.')

    await truncateAll()
    console.log('Truncated tables.')

    const users = await seedUsers()
    console.log('Seeded users:', users.length)

    const gridNodes = await seedGridNodes()
    console.log('Seeded grid_nodes:', gridNodes.length)

    const nodeIds = gridNodes.map((n) => n.node_id)
    await seedWeatherMeasurements(nodeIds)
    console.log('Seeded weather_measurements: 500')

    await seedFloodPredictions(nodeIds)
    console.log('Seeded flood_predictions: 100')

    await seedActualFloodReports(users, gridNodes)
    console.log('Seeded actual_flood_reports: 10')

    const admin = users.find((u) => u.role === 'admin') || null
    await seedSystemLogs(admin)

    console.log(`Done in ${Date.now() - started}ms`)
    process.exit(0)
  } catch (e) {
    console.error(e)
    process.exit(1)
  }
}

main()

