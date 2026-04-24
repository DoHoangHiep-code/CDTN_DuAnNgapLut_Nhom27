'use strict'

/**
 * chatbotRoutes.js – Route xử lý câu hỏi Chatbot AQUA Bot
 *
 * POST /api/v1/chatbot/ask
 * Body: { message: string }
 * Response: { reply: string, data?: object }
 *
 * Luồng:
 *  1. Phân tích intent từ tin nhắn người dùng (keyword-based)
 *  2. Query DB (flood_predictions + grid_nodes) theo intent
 *  3. Sinh câu trả lời tự nhiên tiếng Việt
 *  4. Trả về { reply, data? }
 */

const express  = require('express')
const { QueryTypes } = require('sequelize')
const { sequelize } = require('../db/sequelize')

const router = express.Router()

// ─── Cấu hình ─────────────────────────────────────────────────────────────────

/** Múi giờ Việt Nam cho định dạng thời gian */
const TZ = 'Asia/Ho_Chi_Minh'

/** Số giờ tối đa bot sẽ lấy dự báo (4 ngày = 96h) */
const FORECAST_HOURS = 96

// ─── Helper: định dạng thời gian tiếng Việt ──────────────────────────────────

/**
 * Format ISO datetime → chuỗi dễ đọc tiếng Việt
 * @param {string|Date} dt
 * @returns {string} VD: "17:00, Thứ Năm 24/04"
 */
function formatVN(dt) {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone:  TZ,
    weekday:   'short',
    day:       '2-digit',
    month:     '2-digit',
    hour:      '2-digit',
    minute:    '2-digit',
  }).format(new Date(dt))
}

// ─── Helper: dịch risk_level sang tiếng Việt ────────────────────────────────

const RISK_LABEL = {
  safe:   'An toàn',
  medium: 'Nguy cơ thấp',
  high:   'Nguy cơ cao',
  severe: 'Nguy hiểm nghiêm trọng',
}

const RISK_EMOJI = {
  safe:   '🟢',
  medium: '🟡',
  high:   '🟠',
  severe: '🔴',
}

function riskLabel(level) {
  return `${RISK_EMOJI[level] ?? '⚪'} ${RISK_LABEL[level] ?? level}`
}

// ─── Helper: phân tích intent từ tin nhắn ────────────────────────────────────

/**
 * Phân tích ý định người dùng dựa trên keyword matching (tiếng Việt)
 *
 * Intent list:
 *  - EXPLAIN_RISK    : "vì sao", "tại sao", "nguyên nhân", "giải thích"
 *  - SPECIFIC_TIME   : "17h", "sáng", "chiều", "ngày mai", "hôm nay" + "ngập"
 *  - CURRENT_STATUS  : "hiện tại", "bây giờ", "đang"
 *  - WORST_AREA      : "khu vực nào", "đâu nguy hiểm", "nặng nhất"
 *  - SAFE_ADVICE     : "an toàn", "nên ra ngoài", "có thể đi"
 *  - FORECAST_4DAYS  : "dự báo", "tương lai", "4 ngày", "96 giờ"
 *  - GREETING        : "xin chào", "hello", "hi", "chào"
 *  - UNKNOWN         : fallback
 *
 * @param {string} msg
 * @returns {string} intent key
 */
function detectIntent(msg) {
  const m = msg.toLowerCase()

  // Chào hỏi
  if (/\b(xin chào|hello|hi|chào bot|chào aqua)\b/.test(m)) return 'GREETING'

  // Giải thích lý do
  if (/(vì sao|tại sao|nguyên nhân|giải thích|lý do|sao lại|vì lý do gì)/.test(m)) return 'EXPLAIN_RISK'

  // Hỏi khu vực nguy hiểm nhất
  if (/(khu vực nào|đâu nguy hiểm|nặng nhất|nguy hiểm nhất|khu nào ngập|ngập nặng)/.test(m)) return 'WORST_AREA'

  // Hỏi thời điểm cụ thể (có giờ hoặc ngày kèm theo từ ngập)
  if (/(\d{1,2}h|\d{1,2}:\d{2}|sáng|chiều|tối|trưa|ngày mai|hôm nay|ngày kia)/.test(m) &&
      /(ngập|mưa|lũ|dự báo|nguy cơ)/.test(m)) return 'SPECIFIC_TIME'

  // Hỏi tình trạng hiện tại
  if (/(hiện tại|bây giờ|đang ngập|lúc này|ngay bây giờ|hiện giờ)/.test(m)) return 'CURRENT_STATUS'

  // Hỏi lời khuyên an toàn
  if (/(an toàn không|nên đi không|có thể ra|nên ở nhà|nguy hiểm không)/.test(m)) return 'SAFE_ADVICE'

  // Dự báo 4 ngày
  if (/(dự báo|ngập lụt|lũ lụt|4 ngày|96 giờ|tuần|sắp tới|trong thời gian)/.test(m)) return 'FORECAST_4DAYS'

  return 'UNKNOWN'
}

// ─── Query functions ──────────────────────────────────────────────────────────

/**
 * Lấy tóm tắt dự báo: đếm số node theo từng mức risk trong 4 ngày tới
 */
async function queryForecastSummary() {
  const sql = `
    SELECT
      fp.risk_level,
      COUNT(DISTINCT fp.node_id) AS node_count,
      MIN(fp.flood_depth_cm)     AS min_depth,
      MAX(fp.flood_depth_cm)     AS max_depth,
      AVG(fp.flood_depth_cm)     AS avg_depth
    FROM flood_predictions fp
    WHERE fp.time BETWEEN NOW() AND NOW() + INTERVAL '${FORECAST_HOURS} hours'
    GROUP BY fp.risk_level
    ORDER BY
      CASE fp.risk_level
        WHEN 'severe' THEN 4
        WHEN 'high'   THEN 3
        WHEN 'medium' THEN 2
        ELSE 1
      END DESC
  `
  return sequelize.query(sql, { type: QueryTypes.SELECT })
}

/**
 * Lấy dự báo tại thời điểm hiện tại (±30 phút)
 */
async function queryCurrentStatus() {
  const sql = `
    SELECT
      fp.risk_level,
      fp.flood_depth_cm,
      fp.explanation,
      fp.time,
      gn.latitude,
      gn.longitude
    FROM flood_predictions fp
    JOIN grid_nodes gn ON gn.node_id = fp.node_id
    WHERE fp.time BETWEEN NOW() - INTERVAL '30 minutes'
                      AND NOW() + INTERVAL '30 minutes'
    ORDER BY fp.flood_depth_cm DESC
    LIMIT 10
  `
  return sequelize.query(sql, { type: QueryTypes.SELECT })
}

/**
 * Lấy node + thời điểm có nguy cơ cao nhất trong 4 ngày tới
 */
async function queryWorstArea() {
  const sql = `
    SELECT
      fp.node_id,
      fp.risk_level,
      fp.flood_depth_cm,
      fp.explanation,
      fp.time,
      gn.latitude,
      gn.longitude
    FROM flood_predictions fp
    JOIN grid_nodes gn ON gn.node_id = fp.node_id
    WHERE fp.time BETWEEN NOW() AND NOW() + INTERVAL '${FORECAST_HOURS} hours'
      AND fp.risk_level IN ('high', 'severe')
    ORDER BY fp.flood_depth_cm DESC
    LIMIT 5
  `
  return sequelize.query(sql, { type: QueryTypes.SELECT })
}

/**
 * Lấy dự báo theo giờ cụ thể (target: số giờ từ hiện tại)
 * @param {number} hoursOffset - số giờ từ bây giờ (0 = giờ tiếp theo, 12 = ngày mai buổi trưa…)
 */
async function queryByTime(hoursOffset) {
  const sql = `
    SELECT
      fp.risk_level,
      fp.flood_depth_cm,
      fp.explanation,
      fp.time
    FROM flood_predictions fp
    WHERE fp.time BETWEEN (NOW() + INTERVAL '${hoursOffset} hours')
                      AND (NOW() + INTERVAL '${hoursOffset + 2} hours')
    ORDER BY fp.flood_depth_cm DESC
    LIMIT 10
  `
  return sequelize.query(sql, { type: QueryTypes.SELECT })
}

/**
 * Lấy dự báo chi tiết để giải thích nguyên nhân
 * (Lấy các bản ghi có nguy cơ cao nhất + explanation đầy đủ)
 */
async function queryForExplanation() {
  const sql = `
    SELECT
      fp.risk_level,
      fp.flood_depth_cm,
      fp.explanation,
      fp.time,
      gn.latitude,
      gn.longitude,
      gn.elevation,
      gn.slope,
      gn.impervious_ratio
    FROM flood_predictions fp
    JOIN grid_nodes gn ON gn.node_id = fp.node_id
    WHERE fp.time BETWEEN NOW() AND NOW() + INTERVAL '24 hours'
      AND fp.risk_level IN ('high', 'severe')
    ORDER BY fp.flood_depth_cm DESC
    LIMIT 5
  `
  return sequelize.query(sql, { type: QueryTypes.SELECT })
}

// ─── Response generators ──────────────────────────────────────────────────────

/** Sinh câu trả lời cho GREETING */
function replyGreeting() {
  return `👋 Xin chào! Tôi là **AQUA Bot** – trợ lý thông minh của hệ thống AQUAALERT.\n\nTôi có thể giúp bạn:\n🌊 Dự báo nguy cơ ngập lụt 4 ngày tới\n📍 Xác định khu vực nguy hiểm nhất\n🔍 Giải thích nguyên nhân nguy cơ ngập\n⚠️ Tư vấn an toàn khi có cảnh báo\n\nHãy hỏi tôi bất cứ điều gì!`
}

/** Sinh câu trả lời cho FORECAST_4DAYS từ summary data */
function replyForecast(rows) {
  if (!rows.length) {
    return '📭 Hiện chưa có dữ liệu dự báo trong DB. Vui lòng kích hoạt Cronjob để cập nhật dữ liệu.'
  }

  const lines = rows.map(r => {
    const depth = Number(r.avg_depth).toFixed(1)
    return `  ${riskLabel(r.risk_level)}: **${r.node_count} điểm đo** (TB ${depth}cm, max ${Number(r.max_depth).toFixed(0)}cm)`
  })

  return `📊 **Dự báo ngập lụt 4 ngày tới:**\n\n${lines.join('\n')}\n\n💡 Bạn muốn biết khu vực nào nguy hiểm nhất? Hỏi tôi "Đâu nguy hiểm nhất?" nhé!`
}

/** Sinh câu trả lời cho CURRENT_STATUS */
function replyCurrentStatus(rows) {
  if (!rows.length) {
    return '✅ Hiện tại không có dữ liệu ngập tại thời điểm này. Có thể chưa có dữ liệu gần với thời điểm hiện tại, hoặc khu vực đang an toàn.'
  }

  const worstRow = rows[0]
  const worstRisk = worstRow.risk_level
  const count = rows.length

  let msg = `🕐 **Tình trạng hiện tại (${formatVN(new Date())}):**\n\n`

  if (worstRisk === 'safe') {
    msg += '✅ Tất cả các điểm đo đang ở mức **An toàn**. Không có nguy cơ ngập trong thời điểm này.'
  } else {
    msg += `⚠️ Phát hiện **${count} điểm đo** có nguy cơ ngập:\n`
    msg += `  Mức nguy hiểm cao nhất: **${riskLabel(worstRisk)}** (${Number(worstRow.flood_depth_cm).toFixed(1)}cm)\n`
    if (worstRow.explanation) {
      msg += `\n💬 ${worstRow.explanation}`
    }
  }

  return msg
}

/** Sinh câu trả lời cho WORST_AREA */
function replyWorstArea(rows) {
  if (!rows.length) {
    return '✅ Tuyệt vời! Trong 4 ngày tới, không có khu vực nào được dự báo ở mức nguy cơ cao hoặc nghiêm trọng.'
  }

  let msg = `🚨 **Top khu vực nguy cơ cao nhất (4 ngày tới):**\n\n`

  rows.forEach((r, i) => {
    const time = formatVN(r.time)
    msg += `**${i + 1}.** Node ${r.node_id} (${Number(r.latitude).toFixed(4)}°N, ${Number(r.longitude).toFixed(4)}°E)\n`
    msg += `   ${riskLabel(r.risk_level)} – Độ ngập dự báo: **${Number(r.flood_depth_cm).toFixed(1)}cm**\n`
    msg += `   ⏰ Thời điểm: ${time}\n\n`
  })

  msg += '⚠️ Khuyến cáo: Hạn chế di chuyển qua các khu vực trên khi có cảnh báo!'

  return msg
}

/** Sinh câu trả lời cho EXPLAIN_RISK – đây là tính năng "chí mạng" */
function replyExplanation(rows) {
  if (!rows.length) {
    return '🔍 Hiện tại không tìm thấy khu vực nào có nguy cơ cao để giải thích. Có thể điều kiện thời tiết đang thuận lợi!'
  }

  const r = rows[0] // Lấy trường hợp nguy hiểm nhất để giải thích

  let msg = `🔬 **Giải thích nguyên nhân nguy cơ ngập cao:**\n\n`
  msg += `📍 **Khu vực:** (${Number(r.latitude).toFixed(4)}°N, ${Number(r.longitude).toFixed(4)}°E)\n`
  msg += `📊 **Độ ngập dự báo:** ${Number(r.flood_depth_cm).toFixed(1)}cm\n`
  msg += `⏰ **Thời điểm:** ${formatVN(r.time)}\n\n`

  // Giải thích từ DB (do weatherCron sinh ra)
  if (r.explanation) {
    msg += `💬 **Phân tích:** ${r.explanation}\n\n`
  }

  // Giải thích bổ sung từ đặc điểm địa lý node
  msg += `🌍 **Đặc điểm địa lý tại điểm này:**\n`
  msg += `  • Cao độ: **${Number(r.elevation).toFixed(1)}m** (${Number(r.elevation) < 5 ? 'địa hình thấp, dễ tích nước' : 'tương đối cao'})\n`
  msg += `  • Độ dốc: **${Number(r.slope).toFixed(2)}°** (${Number(r.slope) < 1 ? 'gần như phẳng, nước thoát chậm' : 'có độ dốc nhất định'})\n`
  msg += `  • Tỷ lệ bê tông hóa: **${(Number(r.impervious_ratio) * 100).toFixed(0)}%** (${Number(r.impervious_ratio) > 0.6 ? 'đô thị hóa cao, nước mưa không thấm được' : 'còn diện tích xanh'})\n\n`

  msg += `🤖 *Dự báo được tính bằng mô hình AI CatBoost dựa trên dữ liệu thời tiết Open-Meteo.*`

  return msg
}

/** Sinh câu trả lời cho SAFE_ADVICE */
function replySafeAdvice(summaryRows) {
  const hasHighRisk = summaryRows.some(r => ['high', 'severe'].includes(r.risk_level))

  if (!summaryRows.length || !hasHighRisk) {
    return `✅ **Tình trạng an toàn!**\n\nHiện tại và 4 ngày tới không có khu vực nào được dự báo ngập ở mức nguy hiểm.\n\n🚗 Bạn có thể di chuyển bình thường. Tuy nhiên hãy theo dõi thông báo cập nhật!`
  }

  const severeRow = summaryRows.find(r => r.risk_level === 'severe')
  const highRow   = summaryRows.find(r => r.risk_level === 'high')
  const worstRow  = severeRow ?? highRow

  let msg = `⚠️ **Cảnh báo! Có nguy cơ ngập trong 4 ngày tới:**\n\n`

  if (severeRow) {
    msg += `🔴 **${severeRow.node_count} điểm đo** ở mức **Nguy hiểm nghiêm trọng** (tới ${Number(worstRow.max_depth).toFixed(0)}cm)\n\n`
  } else if (highRow) {
    msg += `🟠 **${highRow.node_count} điểm đo** ở mức **Nguy cơ cao** (tới ${Number(worstRow.max_depth).toFixed(0)}cm)\n\n`
  }

  msg += `📋 **Khuyến nghị:**\n`
  msg += `  • Hạn chế di chuyển vào giờ cao điểm nguy cơ\n`
  msg += `  • Không đi qua vùng trũng thấp khi trời mưa lớn\n`
  msg += `  • Chuẩn bị dụng cụ phòng lụt nếu cần\n`
  msg += `  • Theo dõi bản đồ ngập lụt tại mục **Bản đồ** trong ứng dụng\n\n`
  msg += `💡 Hỏi "Đâu nguy hiểm nhất?" để xem chi tiết khu vực cần tránh.`

  return msg
}

/** Câu trả lời khi không hiểu ý định */
function replyUnknown() {
  return `🤔 Xin lỗi, tôi chưa hiểu câu hỏi của bạn.\n\nBạn có thể hỏi tôi:\n• **"Dự báo ngập 4 ngày tới thế nào?"**\n• **"Đâu là khu vực nguy hiểm nhất?"**\n• **"Vì sao khu vực X có nguy cơ cao?"**\n• **"Hiện tại có ngập không?"**\n• **"Có nên ra ngoài không?"**`
}

// ─── Route chính ──────────────────────────────────────────────────────────────

/**
 * POST /api/v1/chatbot/ask
 * Body: { message: string }
 * Trả về: { reply: string, intent: string, data?: object }
 */
router.post('/chatbot/ask', async (req, res, next) => {
  try {
    const message = (req.body?.message ?? '').trim()

    // Validate input
    if (!message) {
      return res.status(400).json({
        success: false,
        error: { message: 'Vui lòng nhập câu hỏi.' },
      })
    }

    // Giới hạn độ dài để tránh spam
    if (message.length > 500) {
      return res.status(400).json({
        success: false,
        error: { message: 'Câu hỏi quá dài (tối đa 500 ký tự).' },
      })
    }

    // Bước 1: Phân tích intent
    const intent = detectIntent(message)
    console.log(`[Chatbot] Intent: ${intent} | Message: "${message.substring(0, 50)}"`)

    let reply = ''
    let data  = null

    // Bước 2: Query DB và sinh câu trả lời theo intent
    switch (intent) {

      case 'GREETING':
        reply = replyGreeting()
        break

      case 'FORECAST_4DAYS': {
        const rows = await queryForecastSummary()
        reply = replyForecast(rows)
        data  = rows
        break
      }

      case 'CURRENT_STATUS': {
        const rows = await queryCurrentStatus()
        reply = replyCurrentStatus(rows)
        data  = rows
        break
      }

      case 'WORST_AREA': {
        const rows = await queryWorstArea()
        reply = replyWorstArea(rows)
        data  = rows
        break
      }

      case 'EXPLAIN_RISK': {
        const rows = await queryForExplanation()
        reply = replyExplanation(rows)
        data  = rows
        break
      }

      case 'SAFE_ADVICE': {
        const rows = await queryForecastSummary()
        reply = replySafeAdvice(rows)
        data  = rows
        break
      }

      case 'SPECIFIC_TIME': {
        // Tìm offset giờ từ tin nhắn (đơn giản: +12h cho ngày mai, +24h cho ngày kia)
        const m = message.toLowerCase()
        let offset = 0
        if (/(ngày mai|tomorrow)/.test(m))      offset = 12
        else if (/(ngày kia|day after)/.test(m)) offset = 36
        else if (/chiều/.test(m))                offset = 6
        else if (/tối/.test(m))                  offset = 10

        const rows = await queryByTime(offset)
        if (!rows.length) {
          reply = `📭 Không tìm thấy dữ liệu dự báo cho khoảng thời gian đó. Có thể dữ liệu chưa được cập nhật.`
        } else {
          const worst = rows[0]
          reply = `⏰ **Dự báo lúc ~${formatVN(worst.time)}:**\n\n`
          reply += `Mức độ nguy hiểm cao nhất: **${riskLabel(worst.risk_level)}** (${Number(worst.flood_depth_cm).toFixed(1)}cm)\n`
          if (worst.explanation) reply += `\n💬 ${worst.explanation}`
        }
        data = rows
        break
      }

      default:
        reply = replyUnknown()
    }

    return res.status(200).json({
      success: true,
      data: { reply, intent, extraData: data },
    })

  } catch (err) {
    console.error('[Chatbot] Lỗi xử lý:', err.message)
    return next(err)
  }
})

module.exports = { chatbotRouter: router }
