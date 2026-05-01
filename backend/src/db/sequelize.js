const { Sequelize } = require('sequelize')
const config = require('./config')

const env = process.env.NODE_ENV || 'development'
const cfg = config[env]

// Ưu tiên dùng DATABASE_URL (phù hợp môi trường cloud như Aiven).
// Nếu không có thì fallback về cấu hình cũ theo từng biến DB_*.
// Ưu tiên pooler URL (IPv4) nếu có, vì nhiều mạng nội bộ không đi được IPv6 direct DB host.
const rawDatabaseUrl = process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL

/**
 * Chuẩn hóa DATABASE_URL để tránh lỗi "Invalid URL" khi password có ký tự đặc biệt
 * như #, %, !, *... (rất hay gặp với Aiven URI).
 */
function normalizeDatabaseUrl(input) {
  if (typeof input !== 'string' || !input.trim()) return ''

  // Bỏ khoảng trắng/ngoặc kép dư khi copy từ dashboard.
  const trimmed = input.trim().replace(/^"(.*)"$/, '$1')

  // Chỉ chấp nhận scheme postgres chuẩn.
  const safe = trimmed.replace(/^DATABASE_URL=/i, '') // Chống lỗi dán nhầm "DATABASE_URL=..." vào value
  if (!/^postgres(ql)?:\/\//i.test(safe)) return ''

  // Nếu không có format URI chuẩn thì bỏ qua để fallback local DB thay vì crash.
  if (!safe.includes('://') || !safe.includes('@')) return ''

  try {
    const [protocol, rest] = safe.split('://')
    const atIndex = rest.lastIndexOf('@')
    if (atIndex < 0) return ''

    const credentials = rest.slice(0, atIndex) // user:password
    const hostAndDb = rest.slice(atIndex + 1)
    const colonIndex = credentials.indexOf(':')
    if (colonIndex < 0) return ''

    const username = credentials.slice(0, colonIndex)
    const rawPassword = credentials.slice(colonIndex + 1).trim()

    // Encode password để URL parser của pg nhận đúng (đặc biệt ký tự #/%).
    let safePassword = rawPassword
    try {
      safePassword = encodeURIComponent(decodeURIComponent(rawPassword))
    } catch {
      safePassword = encodeURIComponent(rawPassword)
    }

    return `${protocol}://${username}:${safePassword}@${hostAndDb}`
  } catch {
    return ''
  }
}

const normalizedDatabaseUrl = normalizeDatabaseUrl(rawDatabaseUrl)

const sslDialectOptions = {
  ssl: {
    require: true,
    rejectUnauthorized: false,
  },
}

const sequelize = normalizedDatabaseUrl
  ? new Sequelize(normalizedDatabaseUrl, {
      dialect: 'postgres',
      logging: false,
      dialectOptions: sslDialectOptions,
    })
  : new Sequelize(cfg.database, cfg.username, cfg.password, cfg)

if (rawDatabaseUrl && !normalizedDatabaseUrl) {
  // eslint-disable-next-line no-console
  console.warn('[DB] DATABASE_URL không hợp lệ, đang fallback sang DB_* local.')
}

module.exports = { sequelize }

