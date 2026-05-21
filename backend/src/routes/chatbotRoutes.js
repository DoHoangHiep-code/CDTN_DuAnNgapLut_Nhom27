'use strict'

const express = require('express')
const { QueryTypes } = require('sequelize')
const { sequelize } = require('../db/sequelize')
const redis = require('../common/services/redisClient')

const router = express.Router()

const TZ = 'Asia/Ho_Chi_Minh'
const FORECAST_HOURS = 96
const CACHE_TTL = 60 // 60 giây

// ─── Pool pg riêng cho chatbot (tránh tranh chấp) ────────────────────────────
const { Pool } = require('pg')
const pool = new Pool({
  connectionString: process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 8000,
})
pool.on('error', (err) => console.error('[ChatbotPool]', err.message))

// ─── Helper: timeout guard ────────────────────────────────────────────────────
function withTimeout(promise, ms = 6000) {
  let t
  const tp = new Promise((_, reject) => {
    t = setTimeout(() => reject(Object.assign(new Error(`Query timeout ${ms}ms`), { code: 'QUERY_TIMEOUT' })), ms)
  })
  return Promise.race([promise, tp]).finally(() => clearTimeout(t))
}

// ─── Helper: Redis cache wrapper (có null-guard cho trường hợp Redis offline) ───────────
async function cached(key, ttl, fn) {
  if (redis && redis.isReady) {
    try {
      const hit = await redis.get(key)
      if (hit) return JSON.parse(hit)
    } catch (_) {}
  }
  const result = await fn()
  if (redis && redis.isReady) {
    try { await redis.setEx(key, ttl, JSON.stringify(result)) } catch (_) {}
  }
  return result
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatVN(dt) {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: TZ, weekday: 'short', day: '2-digit',
    month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(dt))
}

const RISK_LABEL = { safe: 'An toàn', medium: 'Nguy cơ thấp', high: 'Nguy cơ cao', severe: 'Nguy hiểm nghiêm trọng' }
const RISK_EMOJI = { safe: '🟢', medium: '🟡', high: '🟠', severe: '🔴' }
function riskLabel(level) { return `${RISK_EMOJI[level] ?? '⚪'} ${RISK_LABEL[level] ?? level}` }

// ─── Danh sách địa danh Hà Nội phổ biến ─────────────────────────────────────
const AREA_KEYWORDS = [
  'triều khúc', 'cầu giấy', 'hoàn kiếm', 'đống đa', 'hà đông', 'thanh xuân',
  'bắc từ liêm', 'nam từ liêm', 'tây hồ', 'long biên', 'hoàng mai', 'hai bà trưng',
  'ba đình', 'đống đa', 'gia lâm', 'sóc sơn', 'đông anh', 'mê linh', 'thường tín',
  'phú xuyên', 'ứng hòa', 'mỹ đức', 'thanh oai', 'chương mỹ', 'quốc oai',
  'thạch thất', 'phúc thọ', 'dan phượng', 'hoài đức',
]

// ─── detectIntent ─────────────────────────────────────────────────────────────
function detectIntent(msg) {
  const m = msg.toLowerCase()

  if (/(?:^|\s)(xin chào|hello|hi|chào bot|chào aqua)(?:\s|$)/.test(m)) return 'GREETING'
  if (/(vì sao|tại sao|nguyên nhân|giải thích|lý do|sao lại|vì lý do gì)/.test(m)) return 'EXPLAIN_RISK'
  if (/(khu vực nào|đâu nguy hiểm|nặng nhất|nguy hiểm nhất|khu nào ngập|ngập nặng)/.test(m)) return 'WORST_AREA'

  // Địa danh cụ thể
  const foundArea = AREA_KEYWORDS.find(kw => m.includes(kw))
  if (foundArea) return `SPECIFIC_AREA:${foundArea}`

  if (/(\d{1,2}h|\d{1,2}:\d{2}|sáng|chiều|tối|trưa|ngày mai|hôm nay|ngày kia)/.test(m) &&
    /(ngập|mưa|lũ|dự báo|nguy cơ)/.test(m)) return 'SPECIFIC_TIME'
  if (/(hiện tại|bây giờ|đang ngập|lúc này|ngay bây giờ|hiện giờ)/.test(m)) return 'CURRENT_STATUS'
  if (/(an toàn không|nên đi không|có thể ra|nên ở nhà|nguy hiểm không)/.test(m)) return 'SAFE_ADVICE'
  if (/(dự báo|ngập lụt|lũ lụt|4 ngày|96 giờ|tuần|sắp tới|trong thời gian)/.test(m)) return 'FORECAST_4DAYS'

  return 'UNKNOWN'
}

// ─── Query functions ──────────────────────────────────────────────────────────
async function queryForecastSummary() {
  return cached('chatbot:forecast_summary', CACHE_TTL, async () => {
    // Dùng parameterized query thay vì string interpolation
    // Bỏ AS OF SYSTEM TIME (sai vị trí, gây syntax error trong CockroachDB)
    const sql = `
      SELECT fp.risk_level,
        COUNT(DISTINCT fp.node_id) AS node_count,
        MIN(fp.flood_depth_cm)     AS min_depth,
        MAX(fp.flood_depth_cm)     AS max_depth,
        AVG(fp.flood_depth_cm)     AS avg_depth
      FROM flood_predictions fp
      WHERE fp.time BETWEEN NOW() AND NOW() + ($1 * INTERVAL '1 hour')
      GROUP BY fp.risk_level
      ORDER BY CASE fp.risk_level WHEN 'severe' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC
    `
    const { rows } = await withTimeout(pool.query(sql, [FORECAST_HOURS]))
    return rows
  })
}

async function queryCurrentStatus() {
  return cached('chatbot:current_status', CACHE_TTL, async () => {
    // Bỏ AS OF SYSTEM TIME (sai vị trí)
    const sql = `
      SELECT fp.risk_level, fp.flood_depth_cm, fp.explanation, fp.time,
        gn.latitude, gn.longitude, gn.location_name
      FROM flood_predictions fp
      JOIN grid_nodes gn ON gn.node_id = fp.node_id
      WHERE fp.time BETWEEN NOW() - INTERVAL '30 minutes' AND NOW() + INTERVAL '30 minutes'
      ORDER BY fp.flood_depth_cm DESC
      LIMIT 10
    `
    const { rows } = await withTimeout(pool.query(sql))
    return rows
  })
}

async function queryWorstArea() {
  return cached('chatbot:worst_area', CACHE_TTL, async () => {
    // Dùng parameterized query, bỏ AS OF SYSTEM TIME
    const sql = `
      SELECT fp.node_id, fp.risk_level, fp.flood_depth_cm, fp.explanation, fp.time,
        gn.latitude, gn.longitude, gn.location_name
      FROM flood_predictions fp
      JOIN grid_nodes gn ON gn.node_id = fp.node_id
      WHERE fp.time BETWEEN NOW() AND NOW() + ($1 * INTERVAL '1 hour')
        AND fp.risk_level IN ('high', 'severe')
      ORDER BY fp.flood_depth_cm DESC
      LIMIT 5
    `
    const { rows } = await withTimeout(pool.query(sql, [FORECAST_HOURS]))
    return rows
  })
}

async function queryForExplanation() {
  return cached('chatbot:explain_risk', CACHE_TTL, async () => {
    // Bỏ AS OF SYSTEM TIME (sai vị trí)
    const sql = `
      SELECT fp.risk_level, fp.flood_depth_cm, fp.explanation, fp.time,
        gn.latitude, gn.longitude, gn.elevation, gn.slope, gn.impervious_ratio, gn.location_name
      FROM flood_predictions fp
      JOIN grid_nodes gn ON gn.node_id = fp.node_id
      WHERE fp.time BETWEEN NOW() AND NOW() + INTERVAL '24 hours'
        AND fp.risk_level IN ('high', 'severe')
      ORDER BY fp.flood_depth_cm DESC
      LIMIT 5
    `
    const { rows } = await withTimeout(pool.query(sql))
    return rows
  })
}

async function queryByTime(hoursOffset) {
  // Dùng parameterized query thay vì string interpolation, bỏ AS OF SYSTEM TIME
  const offset = Number.isFinite(hoursOffset) ? Math.round(hoursOffset) : 0
  const sql = `
    SELECT fp.risk_level, fp.flood_depth_cm, fp.explanation, fp.time
    FROM flood_predictions fp
    WHERE fp.time BETWEEN (NOW() + ($1 * INTERVAL '1 hour'))
                      AND (NOW() + (($1 + 2) * INTERVAL '1 hour'))
    ORDER BY fp.flood_depth_cm DESC
    LIMIT 10
  `
  const { rows } = await withTimeout(pool.query(sql, [offset]))
  return rows
}

async function queryByAreaName(areaName) {
  const cacheKey = `chatbot:area:${areaName}`
  return cached(cacheKey, CACHE_TTL, async () => {
    // Bỏ AS OF SYSTEM TIME (sai vị trí)
    const sql = `
      SELECT fp.risk_level, fp.flood_depth_cm, fp.explanation, fp.time,
        gn.location_name, gn.latitude, gn.longitude
      FROM flood_predictions fp
      JOIN grid_nodes gn ON gn.node_id = fp.node_id
      WHERE gn.location_name ILIKE $1
        AND fp.time BETWEEN NOW() AND NOW() + INTERVAL '48 hours'
      ORDER BY fp.flood_depth_cm DESC
      LIMIT 5
    `
    const { rows } = await withTimeout(pool.query(sql, [`%${areaName}%`]))
    return rows
  })
}

// ─── Reply generators ─────────────────────────────────────────────────────────
function replyGreeting() {
  return `👋 Xin chào! Tôi là **AQUA Bot** – trợ lý thông minh của hệ thống AQUAALERT.\n\nTôi có thể giúp bạn:\n🌊 Dự báo nguy cơ ngập lụt 4 ngày tới\n📍 Xác định khu vực nguy hiểm nhất\n🔍 Giải thích nguyên nhân nguy cơ ngập\n⚠️ Tư vấn an toàn khi có cảnh báo\n🗺️ Hỏi về địa danh cụ thể: *"Triều Khúc ngày mai thế nào?"*\n\nHãy hỏi tôi bất cứ điều gì!`
}

function replyForecast(rows) {
  if (!rows.length) return '📭 Hiện chưa có dữ liệu dự báo trong DB. Vui lòng kích hoạt Cronjob để cập nhật dữ liệu.'
  const lines = rows.map(r => `  ${riskLabel(r.risk_level)}: **${r.node_count} điểm đo** (TB ${Number(r.avg_depth).toFixed(1)}cm, max ${Number(r.max_depth).toFixed(0)}cm)`)
  return `📊 **Dự báo ngập lụt 4 ngày tới:**\n\n${lines.join('\n')}\n\n💡 Bạn muốn biết khu vực nào nguy hiểm nhất? Hỏi tôi "Đâu nguy hiểm nhất?" nhé!`
}

function replyCurrentStatus(rows) {
  if (!rows.length) return '✅ Hiện tại không có dữ liệu ngập tại thời điểm này. Có thể khu vực đang an toàn.'
  const worstRow = rows[0]
  let msg = `🕐 **Tình trạng hiện tại (${formatVN(new Date())}):**\n\n`
  if (worstRow.risk_level === 'safe') {
    msg += '✅ Tất cả các điểm đo đang ở mức **An toàn**.'
  } else {
    msg += `⚠️ Phát hiện **${rows.length} điểm đo** có nguy cơ ngập:\n`
    msg += `  Mức nguy hiểm cao nhất: **${riskLabel(worstRow.risk_level)}** (${Number(worstRow.flood_depth_cm).toFixed(1)}cm)\n`
    if (worstRow.location_name) msg += `  📍 Tại: ${worstRow.location_name}\n`
    if (worstRow.explanation) msg += `\n💬 ${worstRow.explanation}`
  }
  return msg
}

function replyWorstArea(rows) {
  if (!rows.length) return '✅ Tuyệt vời! Trong 4 ngày tới, không có khu vực nào được dự báo ở mức nguy cơ cao hoặc nghiêm trọng.'
  let msg = `🚨 **Top khu vực nguy cơ cao nhất (4 ngày tới):**\n\n`
  rows.forEach((r, i) => {
    const time = formatVN(r.time)
    const loc = r.location_name || `(${Number(r.latitude).toFixed(4)}°N, ${Number(r.longitude).toFixed(4)}°E)`
    msg += `**${i + 1}.** ${loc}\n`
    msg += `   ${riskLabel(r.risk_level)} – Độ ngập dự báo: **${Number(r.flood_depth_cm).toFixed(1)}cm**\n`
    msg += `   ⏰ Thời điểm: ${time}\n\n`
  })
  msg += '⚠️ Khuyến cáo: Hạn chế di chuyển qua các khu vực trên khi có cảnh báo!'
  return msg
}

function replyExplanation(rows) {
  if (!rows.length) return '🔍 Hiện tại không tìm thấy khu vực nào có nguy cơ cao để giải thích. Có thể điều kiện thời tiết đang thuận lợi!'
  const r = rows[0]
  const loc = r.location_name || `(${Number(r.latitude).toFixed(4)}°N, ${Number(r.longitude).toFixed(4)}°E)`
  let msg = `🔬 **Giải thích nguyên nhân nguy cơ ngập cao:**\n\n`
  msg += `📍 **Khu vực:** ${loc}\n`
  msg += `📊 **Độ ngập dự báo:** ${Number(r.flood_depth_cm).toFixed(1)}cm\n`
  msg += `⏰ **Thời điểm:** ${formatVN(r.time)}\n\n`
  if (r.explanation) msg += `💬 **Phân tích:** ${r.explanation}\n\n`
  msg += `🌍 **Đặc điểm địa lý:**\n`
  msg += `  • Cao độ: **${Number(r.elevation).toFixed(1)}m** (${Number(r.elevation) < 5 ? 'địa hình thấp, dễ tích nước' : 'tương đối cao'})\n`
  msg += `  • Độ dốc: **${Number(r.slope).toFixed(2)}°** (${Number(r.slope) < 1 ? 'gần như phẳng, nước thoát chậm' : 'có độ dốc nhất định'})\n`
  msg += `  • Bê tông hóa: **${(Number(r.impervious_ratio) * 100).toFixed(0)}%** (${Number(r.impervious_ratio) > 0.6 ? 'đô thị hóa cao, nước mưa không thấm được' : 'còn diện tích xanh'})\n\n`
  msg += `🤖 *Dự báo được tính bằng mô hình AI CatBoost dựa trên dữ liệu thời tiết Open-Meteo.*`
  return msg
}

function replySafeAdvice(summaryRows) {
  const hasHighRisk = summaryRows.some(r => ['high', 'severe'].includes(r.risk_level))
  if (!summaryRows.length || !hasHighRisk) {
    return `✅ **Tình trạng an toàn!**\n\nHiện tại và 4 ngày tới không có khu vực nào được dự báo ngập ở mức nguy hiểm.\n\n🚗 Bạn có thể di chuyển bình thường. Tuy nhiên hãy theo dõi thông báo cập nhật!`
  }
  const severeRow = summaryRows.find(r => r.risk_level === 'severe')
  const highRow = summaryRows.find(r => r.risk_level === 'high')
  const worstRow = severeRow ?? highRow
  let msg = `⚠️ **Cảnh báo! Có nguy cơ ngập trong 4 ngày tới:**\n\n`
  if (severeRow) msg += `🔴 **${severeRow.node_count} điểm đo** ở mức **Nguy hiểm nghiêm trọng** (tới ${Number(worstRow.max_depth).toFixed(0)}cm)\n\n`
  else if (highRow) msg += `🟠 **${highRow.node_count} điểm đo** ở mức **Nguy cơ cao** (tới ${Number(worstRow.max_depth).toFixed(0)}cm)\n\n`
  msg += `📋 **Khuyến nghị:**\n  • Hạn chế di chuyển vào giờ cao điểm nguy cơ\n  • Không đi qua vùng trũng thấp khi trời mưa lớn\n  • Chuẩn bị dụng cụ phòng lụt nếu cần\n  • Theo dõi bản đồ ngập lụt tại mục **Bản đồ** trong ứng dụng\n\n`
  msg += `💡 Hỏi "Đâu nguy hiểm nhất?" để xem chi tiết khu vực cần tránh.`
  return msg
}

function replySpecificArea(areaName, rows) {
  if (!rows.length) {
    return `🔍 Không tìm thấy dữ liệu dự báo cho khu vực **${areaName}** trong 48 giờ tới.\n\n💡 Lưu ý: Dữ liệu được cập nhật mỗi 10 phút. Tên địa danh cần khớp với dữ liệu lưu trong hệ thống.`
  }
  const worst = rows[0]
  let msg = `📍 **Dự báo khu vực ${areaName.charAt(0).toUpperCase() + areaName.slice(1)} (48h tới):**\n\n`
  msg += `${riskLabel(worst.risk_level)} – Độ ngập cao nhất dự báo: **${Number(worst.flood_depth_cm).toFixed(1)}cm**\n`
  msg += `⏰ Thời điểm nguy hiểm nhất: ${formatVN(worst.time)}\n`
  if (worst.explanation) msg += `\n💬 ${worst.explanation}\n`
  if (rows.length > 1) {
    msg += `\n📊 **${rows.length} điểm đo trong khu vực:**\n`
    rows.forEach((r, i) => {
      msg += `  ${i + 1}. ${riskLabel(r.risk_level)} – ${Number(r.flood_depth_cm).toFixed(1)}cm lúc ${formatVN(r.time)}\n`
    })
  }
  if (worst.risk_level === 'severe') msg += `\n⛔ Khuyến cáo: KHÔNG di chuyển qua khu vực này khi có mưa lớn!`
  else if (worst.risk_level === 'high') msg += `\n⚠️ Khuyến cáo: Hạn chế di chuyển, theo dõi cập nhật.`
  else msg += `\n✅ Khu vực này tương đối an toàn, vẫn nên theo dõi thời tiết.`
  return msg
}

function replyUnknown() {
  return `🤔 Xin lỗi, tôi chưa hiểu câu hỏi của bạn.\n\nBạn có thể hỏi tôi:\n• **"Dự báo ngập 4 ngày tới thế nào?"**\n• **"Đâu là khu vực nguy hiểm nhất?"**\n• **"Vì sao khu vực X có nguy cơ cao?"**\n• **"Hiện tại có ngập không?"**\n• **"Có nên ra ngoài không?"**\n• **"Triều Khúc ngày mai ngập không?"** ← hỏi theo địa danh!`
}

// ─── Route chính ──────────────────────────────────────────────────────────────
router.post('/chatbot/ask', async (req, res, next) => {
  try {
    const message = (req.body?.message ?? '').trim()
    if (!message) return res.status(400).json({ success: false, error: { message: 'Vui lòng nhập câu hỏi.' } })
    if (message.length > 500) return res.status(400).json({ success: false, error: { message: 'Câu hỏi quá dài (tối đa 500 ký tự).' } })

    const intent = detectIntent(message)
    console.log(`[Chatbot] Intent: ${intent} | Msg: "${message.substring(0, 60)}"`)

    let reply = ''
    let data = null

    try {
      if (intent === 'GREETING') {
        reply = replyGreeting()

      } else if (intent === 'FORECAST_4DAYS') {
        data = await queryForecastSummary()
        reply = replyForecast(data)

      } else if (intent === 'CURRENT_STATUS') {
        data = await queryCurrentStatus()
        reply = replyCurrentStatus(data)

      } else if (intent === 'WORST_AREA') {
        data = await queryWorstArea()
        reply = replyWorstArea(data)

      } else if (intent === 'EXPLAIN_RISK') {
        data = await queryForExplanation()
        reply = replyExplanation(data)

      } else if (intent === 'SAFE_ADVICE') {
        data = await queryForecastSummary()
        reply = replySafeAdvice(data)

      } else if (intent === 'SPECIFIC_TIME') {
        const m = message.toLowerCase()
        let offset = 0
        if (/(ngày mai|tomorrow)/.test(m)) offset = 12
        else if (/(ngày kia|day after)/.test(m)) offset = 36
        else if (/chiều/.test(m)) offset = 6
        else if (/tối/.test(m)) offset = 10
        data = await queryByTime(offset)
        if (!data.length) {
          reply = `📭 Không tìm thấy dữ liệu dự báo cho khoảng thời gian đó.`
        } else {
          const worst = data[0]
          reply = `⏰ **Dự báo lúc ~${formatVN(worst.time)}:**\n\n`
          reply += `Mức độ nguy hiểm cao nhất: **${riskLabel(worst.risk_level)}** (${Number(worst.flood_depth_cm).toFixed(1)}cm)\n`
          if (worst.explanation) reply += `\n💬 ${worst.explanation}`
        }

      } else if (intent.startsWith('SPECIFIC_AREA:')) {
        const areaName = intent.replace('SPECIFIC_AREA:', '')
        data = await queryByAreaName(areaName)
        reply = replySpecificArea(areaName, data)

      } else {
        reply = replyUnknown()
      }
    } catch (queryErr) {
      // Query timeout hoặc DB lỗi → trả về fallback thay vì crash
      if (queryErr.code === 'QUERY_TIMEOUT') {
        console.warn('[Chatbot] DB query timeout – trả fallback')
        reply = `⚠️ Hệ thống đang xử lý dữ liệu lớn, vui lòng thử lại sau ít giây.\n\n💡 Gợi ý: Hỏi về dự báo tổng quan thay vì thời điểm cụ thể để nhận kết quả nhanh hơn.`
      } else {
        throw queryErr
      }
    }

    return res.status(200).json({ success: true, data: { reply, intent, extraData: data } })
  } catch (err) {
    console.error('[Chatbot] Lỗi xử lý:', err.message)
    return next(err)
  }
})

module.exports = { chatbotRouter: router }
