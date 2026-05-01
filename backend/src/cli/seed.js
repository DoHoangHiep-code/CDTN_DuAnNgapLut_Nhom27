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

// Tên 30 quận/huyện Hà Nội — mỗi node được gán 1 quận theo vòng tròn
const HANOI_DISTRICTS = [
  'Ba Đình', 'Hoàn Kiếm', 'Tây Hồ', 'Long Biên', 'Cầu Giấy',
  'Đống Đa', 'Hai Bà Trưng', 'Hoàng Mai', 'Thanh Xuân', 'Sóc Sơn',
  'Đông Anh', 'Gia Lâm', 'Nam Từ Liêm', 'Thanh Trì', 'Bắc Từ Liêm',
  'Mê Linh', 'Hà Đông', 'Sơn Tây', 'Ba Vì', 'Phúc Thọ',
  'Đan Phượng', 'Hoài Đức', 'Quốc Oai', 'Thạch Thất', 'Chương Mỹ',
  'Thanh Oai', 'Thường Tín', 'Phú Xuyên', 'Ứng Hòa', 'Mỹ Đức',
]

// Tọa độ trung tâm tương ứng với từng quận (lat, lng)
const DISTRICT_CENTERS = [
  [21.0340, 105.8412], [21.0278, 105.8520], [21.0745, 105.8200], [21.0612, 105.8989], [21.0319, 105.7900],
  [21.0198, 105.8460], [21.0008, 105.8630], [20.9722, 105.8680], [20.9937, 105.8100], [21.2489, 105.8429],
  [21.1624, 105.8468], [21.0240, 105.9380], [20.9870, 105.7680], [20.9310, 105.8560], [21.0630, 105.7650],
  [21.1870, 105.7430], [20.9590, 105.7820], [21.1347, 105.5060], [21.1950, 105.4000], [21.1060, 105.5550],
  [21.0800, 105.6800], [21.0380, 105.7400], [20.9780, 105.6500], [21.0660, 105.6400], [20.9420, 105.7200],
  [20.9040, 105.7730], [20.8760, 105.8560], [20.8200, 105.8880], [20.8020, 105.7780], [20.7370, 105.7150],
]

async function seedGridNodes() {
  const minLat = 20.8
  const maxLat = 21.3
  const minLng = 105.5
  const maxLng = 106.0

  const nodes = []
  for (let i = 1; i <= 50; i++) {
    const lat = Number(rand(minLat, maxLat).toFixed(6))
    const lng = Number(rand(minLng, maxLng).toFixed(6))
    nodes.push({
      node_id: 100000 + i,
      latitude: lat,
      longitude: lng,
      elevation: Number(rand(0, 25).toFixed(2)),
      slope: Number(rand(0, 10).toFixed(2)),
      impervious_ratio: Number(rand(0.05, 0.95).toFixed(3)),
      geom: pointGeom(lng, lat),
    })
  }

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

