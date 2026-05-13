'use strict'

/**
 * unifiedChatbotRoutes.js – AQUA Bot Unified (v2)
 * ─────────────────────────────────────────────────────────────────────────────
 * TẦNG 1: POST /api/v1/chatbot/ask        – nhanh, < 3s
 * TẦNG 2: POST /api/v1/chatbot/expert-detail – sâu, < 10s
 */

const express = require('express')
const axios = require('axios')
const { Pool } = require('pg')

// ── Shared in-memory cache (populated by floodPredictionCron every 10 min) ───
let floodCache = null
try {
    floodCache = require('../utils/floodCache')
} catch (err) {
    console.warn('[UnifiedChatbot] floodCache không load được:', err.message, '– chạy không có in-memory cache.')
}

// ── Markdown Formatter (2-Tier Templates) ─────────────────────────────────────
const { formatCurrentStatus, formatExplainRisk } = require('../utils/chatbotFormatter')

// ── Fail-safe require ─────────────────────────────────────────────────────────
// Nếu redis hoặc floodFeature.service lỗi khi load (env thiếu, pool fail...),
// module này VẪN export được router → server KHÔNG crash.

let redis = null
try {
    redis = require('../services/redisClient')
} catch (err) {
    console.warn('[UnifiedChatbot] redisClient không load được:', err.message, '– chạy không có cache.')
}

let getFeatureByGridId = null
let getFeatureByLatLng = null
try {
    const svc = require('../services/floodFeature.service')
    getFeatureByGridId = svc.getFeatureByGridId
    getFeatureByLatLng = svc.getFeatureByLatLng
} catch (err) {
    console.warn('[UnifiedChatbot] floodFeature.service không load được:', err.message, '– Tầng 2 bị tắt.')
}

const router = express.Router()

// ─── Config ───────────────────────────────────────────────────────────────────
const TZ = 'Asia/Ho_Chi_Minh'
const FORECAST_HOURS = 96
const CACHE_TTL = 60
const CACHE_TTL_EXPERT = 120
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000'
const AI_TIMEOUT_MS = 10_000   // tăng từ 8s → 10s, AI model cần warm-up
const DB_TIMEOUT_MS = 12_000   // tăng từ 8s → 12s, CockroachDB cloud có latency

// ─── Connection Pool riêng ────────────────────────────────────────────────────
// Pool khởi tạo lazy – không throw khi require, chỉ fail khi query đầu tiên.
const pool = new Pool({
    connectionString: process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 25,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
})
pool.on('error', (err) => console.error('[UnifiedChatbot][Pool]', err.message))

// ─── Helpers chung ────────────────────────────────────────────────────────────

function withTimeout(promise, ms = DB_TIMEOUT_MS, code = 'TIMEOUT') {
    let t
    const guard = new Promise((_, reject) => {
        t = setTimeout(
            () => reject(Object.assign(new Error(`Timeout after ${ms}ms`), { code })),
            ms
        )
    })
    return Promise.race([promise, guard]).finally(() => clearTimeout(t))
}

async function cached(key, ttl, fn) {
    if (redis) {
        try {
            const hit = await redis.get(key)
            if (hit) return { data: JSON.parse(hit), fromCache: true }
        } catch (_) { }
    }
    const data = await fn()
    if (redis) {
        try { await redis.setEx(key, ttl, JSON.stringify(data)) } catch (_) { }
    }
    return { data, fromCache: false }
}

function formatVN(dt) {
    return new Intl.DateTimeFormat('vi-VN', {
        timeZone: TZ, weekday: 'short', day: '2-digit',
        month: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(new Date(dt))
}

const RISK_EMOJI = { safe: '🟢', medium: '🟡', high: '🟠', severe: '🔴' }
const RISK_LABEL = { safe: 'An toàn', medium: 'Nguy cơ thấp', high: 'Nguy cơ cao', severe: 'Nguy hiểm nghiêm trọng' }
const RISK_LABEL_FULL = {
    safe: 'An toàn 🟢', medium: 'Nguy cơ thấp 🟡',
    high: 'Nguy cơ cao 🟠', severe: 'Nguy hiểm nghiêm trọng 🔴',
}

function riskTag(level) { return `${RISK_EMOJI[level] ?? '⚪'} ${RISK_LABEL[level] ?? level}` }
function riskTagFull(level) { return RISK_LABEL_FULL[level] ?? level ?? 'Không xác định' }

// ─── Danh sách địa danh Hà Nội ───────────────────────────────────────────────
const AREA_KEYWORDS = [
    'triều khúc', 'cầu giấy', 'hoàn kiếm', 'đống đa', 'hà đông', 'thanh xuân',
    'bắc từ liêm', 'nam từ liêm', 'tây hồ', 'long biên', 'hoàng mai', 'hai bà trưng',
    'ba đình', 'gia lâm', 'sóc sơn', 'đông anh', 'mê linh', 'thường tín',
    'phú xuyên', 'ứng hòa', 'mỹ đức', 'thanh oai', 'chương mỹ', 'quốc oai',
    'thạch thất', 'phúc thọ', 'đan phượng', 'hoài đức',
]

function extractArea(msg) {
    const m = msg.toLowerCase()
    return AREA_KEYWORDS.find(kw => m.includes(kw)) ?? null
}

// ─── Intent Detection ─────────────────────────────────────────────────────────
function detectIntent(msg) {
    const m = msg.toLowerCase()

    if (/(?:^|\s)(xin chào|hello|hi|chào bot|chào aqua)(?:\s|$)/.test(m))
        return { intent: 'GREETING', area: null, timeOffset: 0 }
    if (/(vì sao|tại sao|nguyên nhân|giải thích|lý do|sao lại|vì lý do gì)/.test(m))
        return { intent: 'EXPLAIN_RISK', area: extractArea(m), timeOffset: 0 }
    if (/(khu vực nào|đâu nguy hiểm|nặng nhất|nguy hiểm nhất|khu nào ngập|ngập nặng)/.test(m))
        return { intent: 'WORST_AREA', area: null, timeOffset: 0 }
    if (/(an toàn không|nên đi không|có thể ra|nên ở nhà|nguy hiểm không)/.test(m))
        return { intent: 'SAFE_ADVICE', area: extractArea(m), timeOffset: 0 }
    if (/(hiện tại|bây giờ|đang ngập|lúc này|ngay bây giờ|hiện giờ)/.test(m))
        return { intent: 'CURRENT_STATUS', area: extractArea(m), timeOffset: 0 }

    if (/(\d{1,2}h|\d{1,2}:\d{2}|sáng|chiều|tối|trưa|ngày mai|hôm nay|ngày kia)/.test(m) &&
        /(ngập|mưa|lũ|dự báo|nguy cơ)/.test(m)) {
        let offset = 0
        if (/(ngày mai|tomorrow)/.test(m)) offset = 12
        else if (/(ngày kia|day after)/.test(m)) offset = 36
        else if (/chiều/.test(m)) offset = 6
        else if (/tối/.test(m)) offset = 10
        return { intent: 'SPECIFIC_TIME', area: extractArea(m), timeOffset: offset }
    }

    const area = extractArea(m)
    if (area) return { intent: 'SPECIFIC_AREA', area, timeOffset: 0 }

    if (/(dự báo|ngập lụt|lũ lụt|4 ngày|96 giờ|tuần|sắp tới|trong thời gian)/.test(m))
        return { intent: 'FORECAST_4DAYS', area: null, timeOffset: 0 }

    return { intent: 'UNKNOWN', area: null, timeOffset: 0 }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TẦNG 1 – Query functions
// Tất cả INTERVAL dùng parameterized ($1) thay vì string interpolation
// AS OF SYSTEM TIME luôn ở CUỐI câu lệnh (CockroachDB requirement)
// ═══════════════════════════════════════════════════════════════════════════════

async function queryForecastSummary() {
    return cached('ucbot:forecast_summary', CACHE_TTL, async () => {
        // Dùng subquery DISTINCT ON để chỉ lấy 1 bản ghi mới nhất mỗi node
        // → tránh quét hàng triệu rows khi bảng flood_predictions có nhiều timestamp
        const sql = `
      SELECT
        sub.risk_level,
        COUNT(DISTINCT sub.node_id) AS node_count,
        MIN(sub.flood_depth_cm)     AS min_depth,
        MAX(sub.flood_depth_cm)     AS max_depth,
        AVG(sub.flood_depth_cm)     AS avg_depth
      FROM (
        SELECT DISTINCT ON (node_id)
          node_id, risk_level, flood_depth_cm
        FROM flood_predictions
        WHERE time >= NOW() - INTERVAL '24 hours'
        ORDER BY node_id, time DESC
      ) sub
      GROUP BY sub.risk_level
      ORDER BY CASE sub.risk_level
        WHEN 'severe' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1
      END DESC
    `
        const { rows } = await withTimeout(pool.query(sql), DB_TIMEOUT_MS)
        return rows
    })
}

async function queryCurrentStatus() {
    return cached('ucbot:current_status', CACHE_TTL, async () => {
        // DISTINCT ON (node_id): chỉ lấy bản ghi mới nhất của mỗi node
        // Window mở rộng 2h (thay vì ±30min quá hẹp, dễ không có data)
        const sql = `
      SELECT sub.node_id, sub.risk_level, sub.flood_depth_cm, sub.explanation, sub.time,
             gn.latitude, gn.longitude, gn.location_name
      FROM (
        SELECT DISTINCT ON (node_id)
          node_id, risk_level, flood_depth_cm, explanation, time
        FROM flood_predictions
        WHERE time >= NOW() - INTERVAL '2 hours'
        ORDER BY node_id, time DESC
      ) sub
      JOIN grid_nodes gn ON gn.node_id = sub.node_id
      WHERE sub.risk_level IN ('high', 'severe')
      ORDER BY sub.flood_depth_cm DESC
      LIMIT 10
    `
        const { rows } = await withTimeout(pool.query(sql), DB_TIMEOUT_MS)
        return rows
    })
}

/**
 * Query dữ liệu CURRENT_STATUS cho một khu vực cụ thể (e.g. "Triều Khúc").
 * Dùng DISTINCT ON (node_id) + ILIKE filter trên location_name.
 * TTL cache 120s để tránh query lặp khi user hỏi liên tục.
 */
async function queryCurrentStatusByArea(areaName) {
    const cacheKey = `ucbot:current_status_area:${areaName.toLowerCase().replace(/\s+/g, '_')}`
    return cached(cacheKey, 120, async () => {
        const sql = `
      SELECT DISTINCT ON (node_id) *
      FROM flood_predictions fp
      JOIN grid_nodes gn USING (node_id)
      WHERE fp.time >= NOW() - INTERVAL '2 hours'
        AND gn.location_name ILIKE $1
      ORDER BY node_id, fp.time DESC
      LIMIT 10
    `
        const { rows } = await withTimeout(pool.query(sql, ['%' + areaName + '%']), DB_TIMEOUT_MS)
        return rows
    })
}

async function queryWorstArea() {
    return cached('ucbot:worst_area', CACHE_TTL, async () => {
        // DISTINCT ON (node_id): chỉ lấy bản ghi mới nhất của mỗi node HIGH/SEVERE
        // WHERE time >= NOW() - INTERVAL '24 hours': giới hạn scan, tương tự CronJob
        // Bọc thêm subquery để ORDER BY flood_depth_cm DESC sau khi đã DISTINCT
        const sql = `
      SELECT sub.node_id, sub.risk_level, sub.flood_depth_cm, sub.explanation, sub.time,
             gn.latitude, gn.longitude, gn.location_name
      FROM (
        SELECT DISTINCT ON (node_id)
          node_id, risk_level, flood_depth_cm, explanation, time
        FROM flood_predictions
        WHERE time >= NOW() - INTERVAL '24 hours'
          AND risk_level IN ('high', 'severe')
        ORDER BY node_id, flood_depth_cm DESC, time DESC
      ) sub
      JOIN grid_nodes gn ON gn.node_id = sub.node_id
      ORDER BY sub.flood_depth_cm DESC
      LIMIT 5
    `
        const { rows } = await withTimeout(pool.query(sql), DB_TIMEOUT_MS)
        return rows
    })
}

async function queryByTime(hoursOffset) {
    // Validate để tránh lỗi khi truyền NaN vào DB
    const offset = Number.isFinite(hoursOffset) ? Math.round(hoursOffset) : 0
    const cacheKey = `ucbot:bytime:${offset}`
    return cached(cacheKey, CACHE_TTL, async () => {
        const sql = `
      SELECT fp.risk_level, fp.flood_depth_cm, fp.explanation, fp.time,
             fp.node_id, gn.location_name
      FROM flood_predictions fp
      JOIN grid_nodes gn ON gn.node_id = fp.node_id
      WHERE fp.time BETWEEN NOW() + ($1 * INTERVAL '1 hour')
                        AND NOW() + (($1 + 2) * INTERVAL '1 hour')
      ORDER BY fp.flood_depth_cm DESC
      LIMIT 10
    `
        const { rows } = await withTimeout(pool.query(sql, [offset]))
        return rows
    })
}

async function queryAreaOverview(areaName) {
    const cacheKey = `ucbot:area_overview:${areaName}`
    return cached(cacheKey, CACHE_TTL, async () => {
        const sql = `
      SELECT fp.node_id, fp.risk_level, fp.flood_depth_cm, fp.explanation, fp.time,
             gn.location_name, gn.latitude, gn.longitude,
             gn.elevation, gn.slope, gn.impervious_ratio
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

async function queryExplainRisk() {
    return cached('ucbot:explain_risk', CACHE_TTL, async () => {
        // DISTINCT ON (node_id) + window 24h gần nhất thay vì scan 24h tương lai
        const sql = `
      SELECT sub.node_id, sub.risk_level, sub.flood_depth_cm, sub.explanation, sub.time,
             gn.latitude, gn.longitude, gn.elevation, gn.slope,
             gn.impervious_ratio, gn.location_name
      FROM (
        SELECT DISTINCT ON (node_id)
          node_id, risk_level, flood_depth_cm, explanation, time
        FROM flood_predictions
        WHERE time >= NOW() - INTERVAL '24 hours'
          AND risk_level IN ('high', 'severe')
        ORDER BY node_id, flood_depth_cm DESC, time DESC
      ) sub
      JOIN grid_nodes gn ON gn.node_id = sub.node_id
      ORDER BY sub.flood_depth_cm DESC
      LIMIT 5
    `
        const { rows } = await withTimeout(pool.query(sql), DB_TIMEOUT_MS)
        return rows
    })
}

/**
 * Query dữ liệu chi tiết cho EXPLAIN_RISK khi user chỉ định khu vực cụ thể.
 * JOIN grid_nodes + weather_measurements + flood_predictions để lấy đầy đủ
 * các feature cần thiết cho Tier 1 + Tier 2 analysis.
 * Dùng DISTINCT ON + 24h window — KHÔNG dùng LEFT JOIN LATERAL.
 */
async function queryAreaExplainRisk(areaName) {
    const cacheKey = `ucbot:area_explain:${areaName}`
    return cached(cacheKey, CACHE_TTL, async () => {
        const sql = `
      SELECT
        gn.node_id, gn.location_name, gn.latitude, gn.longitude,
        gn.elevation, gn.slope, gn.impervious_ratio,
        gn.dist_to_drain_km, gn.dist_to_river_km, gn.dist_to_pump_km,
        gn.dist_to_main_road_km, gn.dist_to_park_km,
        wm.prcp, wm.prcp_3h, wm.prcp_6h, wm.prcp_12h, wm.prcp_24h,
        wm.temp, wm.rhum, wm.wspd, wm.pres, wm.pressure_change_24h,
        wm.max_prcp_3h, wm.max_prcp_6h, wm.max_prcp_12h,
        wm.rainy_season_flag,
        fp.flood_depth_cm, fp.risk_level::text AS risk_level,
        fp.explanation, fp.time
      FROM grid_nodes gn
      LEFT JOIN (
        SELECT DISTINCT ON (node_id) *
        FROM weather_measurements
        WHERE time >= NOW() - INTERVAL '24 hours'
        ORDER BY node_id, time DESC
      ) wm ON gn.node_id = wm.node_id
      LEFT JOIN (
        SELECT DISTINCT ON (node_id) *
        FROM flood_predictions
        WHERE time >= NOW() - INTERVAL '24 hours'
        ORDER BY node_id, time DESC
      ) fp ON gn.node_id = fp.node_id
      WHERE gn.location_name ILIKE $1
      ORDER BY fp.flood_depth_cm DESC NULLS LAST
      LIMIT 1
    `
        const { rows } = await withTimeout(pool.query(sql, [`%${areaName}%`]), DB_TIMEOUT_MS)
        return rows
    })
}

// ═══════════════════════════════════════════════════════════════════════════════
// TẦNG 1 – Reply generators
// ═══════════════════════════════════════════════════════════════════════════════

function replyGreeting() {
    return {
        text: `👋 Xin chào! Tôi là **AQUA Bot** – trợ lý thông minh của hệ thống AQUAALERT.

Tôi có thể giúp bạn:
🌊 Dự báo nguy cơ ngập lụt 4 ngày tới
📍 Xác định khu vực nguy hiểm nhất
🔍 Giải thích nguyên nhân nguy cơ ngập
⚠️ Tư vấn an toàn khi có cảnh báo
🗺️ Hỏi về địa danh: *"Triều Khúc ngày mai thế nào?"*
🤖 Phân tích chuyên sâu bằng mô hình AI CatBoost

Hãy hỏi tôi bất cứ điều gì!`,
        suggestAreas: false,
        expertNodes: [],
    }
}

function replyForecast(rows) {
    if (!rows.length) {
        return { text: '📭 Chưa có dữ liệu dự báo. Vui lòng kích hoạt Cron Job để cập nhật.', suggestAreas: true, expertNodes: [] }
    }
    const lines = rows.map(r =>
        `  ${riskTag(r.risk_level)}: **${r.node_count} điểm đo** ` +
        `(TB ${Number(r.avg_depth).toFixed(1)}cm, max ${Number(r.max_depth).toFixed(0)}cm)`
    )
    return {
        text: `📊 **Dự báo ngập lụt 4 ngày tới:**\n\n${lines.join('\n')}\n\n` +
            `💡 Hỏi "Đâu nguy hiểm nhất?" hoặc chọn một khu vực để xem phân tích chuyên sâu.`,
        suggestAreas: true,
        expertNodes: [],
    }
}

function replyCurrentStatus(rows, areaName) {
    if (!rows.length) {
        return {
            text: `✅ Hiện tại (**${formatVN(new Date())}**) không có điểm đo nào vượt ngưỡng nguy hiểm.`,
            suggestAreas: false, expertNodes: [],
        }
    }
    const expertNodes = rows
        .filter(r => r.node_id && ['high', 'severe'].includes(r.risk_level))
        .slice(0, 3)
        .map(r => ({ node_id: r.node_id, location_name: r.location_name, risk_level: r.risk_level }))
    // Dùng formatter mới: Markdown 3-section template
    const text = formatCurrentStatus(rows, areaName)
    return { text, suggestAreas: false, expertNodes }
}

function replyWorstArea(rows) {
    if (!rows.length) {
        return { text: `✅ Trong 4 ngày tới, không có khu vực nào ở mức nguy cơ cao hoặc nghiêm trọng.`, suggestAreas: false, expertNodes: [] }
    }
    let text = `🚨 **Top khu vực nguy cơ cao nhất (4 ngày tới):**\n\n`
    rows.forEach((r, i) => {
        const loc = r.location_name || `(${Number(r.latitude).toFixed(4)}°N, ${Number(r.longitude).toFixed(4)}°E)`
        text += `**${i + 1}.** ${loc}\n`
        text += `   ${riskTag(r.risk_level)} – Độ ngập: **${Number(r.flood_depth_cm).toFixed(1)}cm**\n`
        text += `   ⏰ ${formatVN(r.time)}\n\n`
    })
    text += `⚠️ Hạn chế di chuyển qua các khu vực trên khi có cảnh báo!\n\n`
    text += `🔬 Chọn một khu vực bên dưới để xem **phân tích chuyên sâu bằng AI**.`
    const expertNodes = rows.map(r => ({ node_id: r.node_id, location_name: r.location_name, risk_level: r.risk_level }))
    return { text, suggestAreas: false, expertNodes }
}

function replyExplainRisk(rows, areaName) {
    if (!rows.length) {
        return { text: `🔍 Không tìm thấy khu vực nguy cơ cao. Điều kiện hiện tại đang thuận lợi!`, suggestAreas: false, expertNodes: [] }
    }
    const r = rows[0]
    const loc = r.location_name || `(${Number(r.latitude).toFixed(4)}°N, ${Number(r.longitude).toFixed(4)}°E)`

    // Kiểm tra xem row có đầy đủ weather features (prcp_3h, elevation, etc.) không
    // Nếu có → dùng formatter Tier 1 + Tier 2 đầy đủ
    // Nếu không (chỉ có flood_predictions basic) → fallback bản tóm tắt cũ
    const hasFullFeatures = (r.prcp_3h != null || r.prcp_6h != null || r.dist_to_drain_km != null)

    let text
    if (hasFullFeatures) {
        // Tier 1 + Tier 2: formatExplainRisk cần đầy đủ weather + geo features
        text = formatExplainRisk(r)
    } else {
        // Fallback: chỉ có data từ flood_predictions + grid_nodes cơ bản
        text = `🔬 **Nguyên nhân nguy cơ ngập cao:**\n\n`
        text += `📍 **Khu vực:** ${loc}\n`
        text += `📊 **Độ ngập dự báo:** ${Number(r.flood_depth_cm || 0).toFixed(1)}cm\n`
        text += `⏰ **Thời điểm:** ${formatVN(r.time)}\n\n`
        if (r.explanation) text += `💬 **Phân tích tóm tắt:** ${r.explanation}\n\n`
        text += `🌍 **Đặc điểm địa lý:**\n`
        text += `  • Cao độ: **${Number(r.elevation || 0).toFixed(1)}m** (${Number(r.elevation || 10) < 5 ? 'địa hình thấp, dễ tích nước' : 'tương đối cao'})\n`
        text += `  • Độ dốc: **${Number(r.slope || 0).toFixed(2)}°** (${Number(r.slope || 2) < 1 ? 'gần phẳng, nước thoát chậm' : 'có độ dốc'})\n`
        text += `  • Bê tông hóa: **${(Number(r.impervious_ratio || 0) * 100).toFixed(0)}%**\n\n`
        text += `🤖 Chọn "Xem phân tích AI đầy đủ" để nhận báo cáo chuyên sâu hơn.`
    }

    return {
        text,
        suggestAreas: false,
        expertNodes: [{ node_id: r.node_id, location_name: loc, risk_level: r.risk_level }]
    }
}

function replySafeAdvice(rows) {
    const hasHighRisk = rows.some(r => ['high', 'severe'].includes(r.risk_level))
    if (!rows.length || !hasHighRisk) {
        return {
            text: `✅ **Tình trạng an toàn!**\n\nHiện tại và 4 ngày tới không có khu vực nào ở mức nguy hiểm.\n🚗 Bạn có thể di chuyển bình thường, nhưng hãy theo dõi cập nhật.`,
            suggestAreas: false, expertNodes: [],
        }
    }
    const severeRow = rows.find(r => r.risk_level === 'severe')
    const highRow = rows.find(r => r.risk_level === 'high')
    const worstRow = severeRow ?? highRow
    let text = `⚠️ **Cảnh báo! Có nguy cơ ngập trong 4 ngày tới:**\n\n`
    if (severeRow)
        text += `🔴 **${severeRow.node_count} điểm đo** ở mức **Nguy hiểm nghiêm trọng** (tới ${Number(worstRow.max_depth).toFixed(0)}cm)\n\n`
    else if (highRow)
        text += `🟠 **${highRow.node_count} điểm đo** ở mức **Nguy cơ cao** (tới ${Number(worstRow.max_depth).toFixed(0)}cm)\n\n`
    text += `📋 **Khuyến nghị:**\n`
    text += `  • Hạn chế di chuyển vào giờ cao điểm nguy cơ\n`
    text += `  • Không đi qua vùng trũng thấp khi trời mưa lớn\n`
    text += `  • Chuẩn bị dụng cụ phòng lụt nếu cần\n\n`
    text += `💡 Hỏi "Đâu nguy hiểm nhất?" để xem khu vực cụ thể cần tránh.`
    return { text, suggestAreas: true, expertNodes: [] }
}

function replySpecificArea(areaName, rows) {
    if (!rows.length) {
        return {
            text: `🔍 Không tìm thấy dữ liệu cho khu vực **${areaName}** trong 48 giờ tới.\n\n` +
                `💡 Dữ liệu được cập nhật mỗi 10 phút. Tên địa danh cần khớp với dữ liệu trong hệ thống.`,
            suggestAreas: true, expertNodes: [],
        }
    }
    const worst = rows[0]
    let text = `📍 **Dự báo khu vực ${areaName.charAt(0).toUpperCase() + areaName.slice(1)} (48h tới):**\n\n`
    text += `${riskTag(worst.risk_level)} – Độ ngập cao nhất: **${Number(worst.flood_depth_cm).toFixed(1)}cm**\n`
    text += `⏰ Thời điểm nguy hiểm nhất: ${formatVN(worst.time)}\n`
    if (worst.explanation) text += `\n💬 ${worst.explanation}\n`
    if (rows.length > 1) {
        text += `\n📊 **${rows.length} điểm đo trong khu vực:**\n`
        rows.forEach((r, i) => {
            text += `  ${i + 1}. ${riskTag(r.risk_level)} – ${Number(r.flood_depth_cm).toFixed(1)}cm lúc ${formatVN(r.time)}\n`
        })
    }
    if (worst.risk_level === 'severe') text += `\n⛔ **Không** di chuyển qua khu vực này khi mưa lớn!`
    else if (worst.risk_level === 'high') text += `\n⚠️ Hạn chế di chuyển, theo dõi cập nhật.`
    else text += `\n✅ Khu vực tương đối an toàn, vẫn nên theo dõi thời tiết.`
    text += `\n\n🤖 Nhấn **"Xem phân tích chuyên gia AI"** để biết nguyên nhân chi tiết.`
    const expertNodes = rows.filter(r => r.node_id).map(r => ({ node_id: r.node_id, location_name: r.location_name, risk_level: r.risk_level }))
    return { text, suggestAreas: false, expertNodes }
}

function replySpecificTime(rows, hoursOffset) {
    if (!rows.length) {
        return { text: `📭 Không tìm thấy dữ liệu dự báo cho khoảng thời gian đó (~${hoursOffset}h tới).`, suggestAreas: false, expertNodes: [] }
    }
    const worst = rows[0]
    let text = `⏰ **Dự báo lúc ~${formatVN(worst.time)}:**\n\n`
    text += `Mức nguy hiểm cao nhất: **${riskTag(worst.risk_level)}** (${Number(worst.flood_depth_cm).toFixed(1)}cm)\n`
    if (worst.location_name) text += `📍 Khu vực: ${worst.location_name}\n`
    if (worst.explanation) text += `\n💬 ${worst.explanation}`
    const expertNodes = rows
        .filter(r => r.node_id && ['high', 'severe'].includes(r.risk_level))
        .slice(0, 3)
        .map(r => ({ node_id: r.node_id, location_name: r.location_name, risk_level: r.risk_level }))
    return { text, suggestAreas: false, expertNodes }
}

function replyUnknownWithAreaPrompt() {
    return {
        text: `🤔 Tôi chưa hiểu câu hỏi của bạn.\n\n` +
            `Bạn có thể hỏi:\n` +
            `• **"Dự báo ngập 4 ngày tới?"**\n` +
            `• **"Đâu là khu vực nguy hiểm nhất?"**\n` +
            `• **"Vì sao có nguy cơ cao?"**\n` +
            `• **"Có nên ra ngoài không?"**\n` +
            `• **"Triều Khúc ngập không?"** ← hỏi theo địa danh!\n\n` +
            `Hoặc chọn một khu vực bên dưới để phân tích ngay:`,
        suggestAreas: true,
        expertNodes: [],
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TẦNG 2 – Expert Analysis (AI CatBoost + Rule-based)
// ═══════════════════════════════════════════════════════════════════════════════

function buildFeatureVector(f) {
    const now = new Date()
    const hour = Number(f.hour ?? now.getHours())
    const month = Number(f.month ?? now.getMonth() + 1)
    const startOfYear = new Date(now.getFullYear(), 0, 0)
    const dayofyear = Math.floor((now - startOfYear) / 86_400_000)
    const dayofweek = now.getDay()
    return {
        prcp: Number(f.prcp ?? 0), prcp_3h: Number(f.prcp_3h ?? 0),
        prcp_6h: Number(f.prcp_6h ?? 0), prcp_12h: Number(f.prcp_12h ?? 0),
        prcp_24h: Number(f.prcp_24h ?? 0), temp: Number(f.temp ?? 28),
        rhum: Number(f.rhum ?? 70), wspd: Number(f.wspd ?? 0),
        pres: Number(f.pres ?? 1010), pressure_change_24h: Number(f.pressure_change_24h ?? 0),
        max_prcp_3h: Number(f.max_prcp_3h ?? 0), max_prcp_6h: Number(f.max_prcp_6h ?? 0),
        max_prcp_12h: Number(f.max_prcp_12h ?? 0), elevation: Number(f.elevation ?? 5),
        slope: Number(f.slope ?? 1), impervious_ratio: Number(f.impervious_ratio ?? 0.5),
        dist_to_drain_km: Number(f.dist_to_drain_km ?? 0.5),
        dist_to_river_km: Number(f.dist_to_river_km ?? 1),
        dist_to_pump_km: Number(f.dist_to_pump_km ?? 1),
        dist_to_main_road_km: Number(f.dist_to_main_road_km ?? 0.3),
        dist_to_park_km: Number(f.dist_to_park_km ?? 0.5),
        hour, dayofweek, month, dayofyear,
        hour_sin: Math.sin((2 * Math.PI * hour) / 24),
        hour_cos: Math.cos((2 * Math.PI * hour) / 24),
        month_sin: Math.sin((2 * Math.PI * month) / 12),
        month_cos: Math.cos((2 * Math.PI * month) / 12),
        rainy_season_flag: (f.rainy_season_flag === true || f.rainy_season_flag === 1) ? 1 : 0,
    }
}

async function callAIService(features) {
    try {
        const res = await withTimeout(
            axios.post(`${AI_SERVICE_URL}/api/predict`, features, { headers: { 'Content-Type': 'application/json' } }),
            AI_TIMEOUT_MS, 'AI_TIMEOUT'
        )
        return { data: res.data, timedOut: false }
    } catch (err) {
        if (err.code === 'AI_TIMEOUT' || err.code === 'ECONNABORTED') {
            console.warn('[UnifiedChatbot][AI] Timeout – fallback rule-based')
            return { data: null, timedOut: true }
        }
        console.warn('[UnifiedChatbot][AI] Lỗi kết nối:', err.message)
        return null
    }
}

function buildRuleReasons(f) {
    const reasons = []
    if (f.prcp_24h >= 120) reasons.push(`Mưa tích lũy 24h đạt **${f.prcp_24h} mm** — hệ thống thoát nước dễ quá tải.`)
    if (f.prcp_6h >= 80) reasons.push(`Mưa 6 giờ đạt **${f.prcp_6h} mm** — nước tích tụ nhanh trên bề mặt.`)
    if (f.prcp_3h >= 50) reasons.push(`Cường độ mưa 3h đạt **${f.prcp_3h} mm** — mưa ngắn hạn cực lớn.`)
    if (f.max_prcp_3h >= 30) reasons.push(`Cường độ cực đại 3h: **${f.max_prcp_3h} mm** — đỉnh mưa vượt ngưỡng.`)
    if (f.elevation <= 5) reasons.push(`Cao độ địa hình thấp (**${f.elevation} m**) — nước từ nơi cao chảy về.`)
    if (f.slope <= 1) reasons.push(`Độ dốc nhỏ (**${f.slope}**) — nước thoát chậm, lưu lại mặt đường.`)
    if (f.impervious_ratio >= 0.7) reasons.push(`Bê tông hóa cao (**${(f.impervious_ratio * 100).toFixed(0)}%**) — nước mưa không thấm.`)
    if (f.dist_to_drain_km <= 0.4) reasons.push(`Gần hệ thống thoát nước (**${f.dist_to_drain_km} km**) — điểm nghẽn tiềm ẩn.`)
    if (f.dist_to_river_km <= 1) reasons.push(`Gần sông/kênh (**${f.dist_to_river_km} km**) — ảnh hưởng mực nước sông khi mưa lớn.`)
    if (f.rainy_season_flag === 1) reasons.push('Đang trong **mùa mưa** — xác suất mưa lớn cao hơn bình thường.')
    if (f.rhum >= 90) reasons.push(`Độ ẩm không khí cao (**${f.rhum}%**) — đất đã bão hòa nước, thấm kém.`)
    if (f.pressure_change_24h <= -3) reasons.push(`Áp suất giảm mạnh (**${f.pressure_change_24h} hPa/24h**) — dấu hiệu thời tiết xấu đang đến.`)
    return reasons
}

function buildExpertReport(question, features, dbRow, aiResult) {
    const locationName = dbRow?.location_name || `Node ${dbRow?.node_id}`
    const riskLevel = aiResult?.risk_level ?? dbRow?.risk_level ?? 'unknown'
    const depthCm = Number(aiResult?.flood_depth_cm ?? dbRow?.flood_depth_cm ?? 0)
    const reasons = buildRuleReasons(features)

    let report = `## 🌊 Phân tích chuyên gia – ${locationName}\n\n`
    report += `**Mức rủi ro ngập:** ${riskTagFull(riskLevel)}\n`
    report += `**Độ sâu ngập dự báo (AI):** ${depthCm.toFixed(1)} cm\n`
    if (dbRow?.distance_km != null)
        report += `**Node gần nhất:** cách **${Number(dbRow.distance_km).toFixed(2)} km**\n`
    report += '\n'

    report += aiResult
        ? `> 🤖 **Mô hình CatBoost** dự báo: **${depthCm.toFixed(1)} cm** → **${riskTagFull(riskLevel)}**\n\n`
        : `> ⚠️ Mô hình AI không phản hồi – kết quả dựa trên **phân tích rule-based**.\n\n`

    if (reasons.length) {
        report += `## ⚡ Các yếu tố nguy cơ chính:\n\n`
        reasons.forEach((r, i) => { report += `${i + 1}. ${r}\n` })
        report += '\n'
    } else {
        report += `> ✅ Không có yếu tố đơn lẻ nào vượt ngưỡng nguy hiểm, nhưng mô hình AI vẫn tính tổng hợp toàn bộ biến.\n\n`
    }

    report += `## 📋 Dữ liệu chi tiết tại thời điểm phân tích:\n\n`
    report += `| Nhóm | Chỉ số | Giá trị |\n|---|---|---|\n`
    report += `| 🌧 Mưa | Hiện tại | ${features.prcp} mm |\n`
    report += `| 🌧 Mưa | 3h / 6h / 12h / 24h | ${features.prcp_3h} / ${features.prcp_6h} / ${features.prcp_12h} / ${features.prcp_24h} mm |\n`
    report += `| 🌧 Mưa | Cực đại 3h / 6h / 12h | ${features.max_prcp_3h} / ${features.max_prcp_6h} / ${features.max_prcp_12h} mm |\n`
    report += `| 🌡 Khí tượng | Nhiệt độ / Độ ẩm / Gió | ${features.temp}°C / ${features.rhum}% / ${features.wspd} m/s |\n`
    report += `| 🌡 Khí tượng | Áp suất / Biến thiên 24h | ${features.pres} hPa / ${features.pressure_change_24h} hPa |\n`
    report += `| 🏔 Địa hình | Cao độ / Độ dốc | ${features.elevation} m / ${features.slope}° |\n`
    report += `| 🏙 Đô thị | Bê tông hóa | ${(features.impervious_ratio * 100).toFixed(0)}% |\n`
    report += `| 🚰 Hạ tầng | Cống / Sông / Bơm | ${features.dist_to_drain_km} km / ${features.dist_to_river_km} km / ${features.dist_to_pump_km} km |\n`
    report += `| 🚰 Hạ tầng | Đường chính / Công viên | ${features.dist_to_main_road_km} km / ${features.dist_to_park_km} km |\n`
    report += `| 🗓 Thời gian | Giờ / Ngày trong tuần | ${features.hour}h / Thứ ${features.dayofweek + 1} |\n`
    report += `| 🗓 Thời gian | Mùa mưa | ${features.rainy_season_flag ? 'Có ✅' : 'Không ❌'} |\n\n`

    report += `## 🛡 Khuyến nghị:\n\n`
    if (riskLevel === 'severe')
        report += `⛔ **NGUY HIỂM NGHIÊM TRỌNG** – Không di chuyển qua khu vực này. Liên hệ ngay cơ quan phòng chống lụt bão.\n`
    else if (riskLevel === 'high')
        report += `⚠️ Hạn chế di chuyển, tránh khu vực thấp trũng, hầm chui, gần sông kênh.\n`
    else if (riskLevel === 'medium')
        report += `🟡 Di chuyển thận trọng, theo dõi thông báo thời tiết liên tục.\n`
    else
        report += `✅ Tình trạng khá an toàn, tiếp tục theo dõi nếu trời có dấu hiệu mưa lớn.\n`

    report += `\n---\n*🤖 Phân tích bằng mô hình AI CatBoost + dữ liệu Open-Meteo. Câu hỏi: "${question}"*`
    return report
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 1 – POST /api/v1/chatbot/ask  (Tầng 1)
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/chatbot/ask', async (req, res) => {
    const startedAt = Date.now()

    try {
        const message = String(req.body?.message || req.body?.question || '').trim()

        if (!message) {
            return res.status(400).json({
                success: false,
                reply: 'Bạn vui lòng nhập câu hỏi.'
            })
        }

        const { intent, area, timeOffset } = detectIntent(message)
        let data = null
        let replyObj = null

        // ── Kiểm tra In-Memory Cache trước khi query DB ────────────────────────
        // floodCache được CronJob cập nhật mỗi 10 phút, isStale() = true nếu > 20 phút
        const cacheAvailable = floodCache && !floodCache.isStale()

        try {
            switch (intent) {
                case 'GREETING':
                    replyObj = replyGreeting()
                    break

                case 'FORECAST_4DAYS':
                    // Ưu tiên đọc từ in-memory cache nếu còn tươi
                    if (cacheAvailable && floodCache.forecastSummary.length > 0) {
                        data = { data: floodCache.forecastSummary, fromCache: true }
                    } else {
                        data = await queryForecastSummary()
                    }
                    replyObj = replyForecast(data.data)
                    break

                case 'CURRENT_STATUS':
                    if (area) {
                        // User hỏi khu vực cụ thể → query area-specific
                        data = await queryCurrentStatusByArea(area)
                        replyObj = replyCurrentStatus(data.data, area)
                    } else {
                        // Tổng quan toàn thành phố
                        if (cacheAvailable && floodCache.currentStatus.length > 0) {
                            data = { data: floodCache.currentStatus, fromCache: true }
                        } else {
                            data = await queryCurrentStatus()
                        }
                        replyObj = replyCurrentStatus(data.data, null)
                    }
                    break

                case 'WORST_AREA':
                    if (cacheAvailable && floodCache.worstAreas.length > 0) {
                        data = { data: floodCache.worstAreas, fromCache: true }
                    } else {
                        data = await queryWorstArea()
                    }
                    replyObj = replyWorstArea(data.data)
                    break

                case 'EXPLAIN_RISK':
                    // Nếu user chỉ định khu vực → query chi tiết area-specific (có weather features)
                    // Nếu không → query top high/severe chung
                    if (area) {
                        data = await queryAreaExplainRisk(area)
                    } else {
                        // Ưu tiên cache trước
                        if (cacheAvailable && floodCache.worstAreas.length > 0) {
                            data = { data: floodCache.worstAreas, fromCache: true }
                        } else {
                            data = await queryExplainRisk()
                        }
                    }
                    replyObj = replyExplainRisk(data.data, area)
                    break

                case 'SAFE_ADVICE':
                    if (cacheAvailable && floodCache.forecastSummary.length > 0) {
                        data = { data: floodCache.forecastSummary, fromCache: true }
                    } else {
                        data = await queryForecastSummary()
                    }
                    replyObj = replySafeAdvice(data.data)
                    break

                case 'SPECIFIC_TIME':
                    data = await queryByTime(timeOffset)
                    replyObj = replySpecificTime(data.data, timeOffset)
                    break

                case 'SPECIFIC_AREA':
                    data = await queryAreaOverview(area)
                    replyObj = replySpecificArea(area, data.data)
                    break

                case 'UNKNOWN':
                default:
                    replyObj = replyUnknownWithAreaPrompt()
                    break
            }
        } catch (queryErr) {
            // ── Timeout hoặc DB lỗi → Fallback graceful (200 OK) ──────────────
            // Log đầy đủ để developer debug, nhưng KHÔNG trả 500 về UI
            console.error('[CHATBOT ERROR] Intent:', intent, '| Query lỗi:', queryErr.message)
            console.error('[CHATBOT ERROR] Stack:', queryErr.stack)

            const isTimeout = queryErr.code === 'TIMEOUT' || queryErr.code === 'QUERY_TIMEOUT'

            // Thử lấy dữ liệu từ in-memory cache kể cả khi đã stale (emergency fallback)
            if (floodCache) {
                if ((intent === 'WORST_AREA' || intent === 'SAFE_ADVICE') && floodCache.worstAreas.length > 0) {
                    replyObj = intent === 'WORST_AREA'
                        ? replyWorstArea(floodCache.worstAreas)
                        : replySafeAdvice(floodCache.forecastSummary.length > 0 ? floodCache.forecastSummary : floodCache.worstAreas)
                    data = { fromCache: true }
                    console.warn('[CHATBOT FALLBACK] Dùng stale cache cho intent:', intent)
                } else if (intent === 'CURRENT_STATUS' && floodCache.currentStatus.length > 0) {
                    replyObj = replyCurrentStatus(floodCache.currentStatus, area)
                    data = { fromCache: true }
                    console.warn('[CHATBOT FALLBACK] Dùng stale cache cho CURRENT_STATUS')
                } else if (intent === 'EXPLAIN_RISK' && floodCache.worstAreas.length > 0) {
                    replyObj = replyExplainRisk(floodCache.worstAreas, area)
                    data = { fromCache: true }
                    console.warn('[CHATBOT FALLBACK] Dùng stale cache cho EXPLAIN_RISK')
                } else if ((intent === 'FORECAST_4DAYS') && floodCache.forecastSummary.length > 0) {
                    replyObj = replyForecast(floodCache.forecastSummary)
                    data = { fromCache: true }
                    console.warn('[CHATBOT FALLBACK] Dùng stale cache cho FORECAST_4DAYS')
                }
            }

            // Nếu vẫn không có data → trả fallback message thân thiện
            if (!replyObj) {
                const fallbackMsg = isTimeout
                    ? `⏳ Hệ thống đang tải dữ liệu từ ${floodCache?.worstAreas?.length > 0 ? 'cache dự phòng' : 'trạm đo'}. ` +
                    `Dữ liệu gần nhất cho thấy có các khu vực cần lưu ý. ` +
                    `Bạn muốn hỏi về khu vực cụ thể nào? _(Ví dụ: "Triều Khúc", "Hà Đông")_`
                    : `⚠️ Hệ thống đang cập nhật dữ liệu. Vui lòng thử lại sau 30 giây hoặc hỏi về khu vực cụ thể.`
                replyObj = { text: fallbackMsg, suggestAreas: true, expertNodes: [] }
            }
        }

        return res.status(200).json({
            success: true,
            reply: replyObj.text,
            intent,
            area,
            suggestAreas: replyObj.suggestAreas ?? false,
            expertNodes: replyObj.expertNodes ?? [],
            fromCache: data?.fromCache || false,
            elapsed_ms: Date.now() - startedAt
        })

    } catch (err) {
        // Lỗi ngoài dự kiến (parse, logic...) – vẫn log đầy đủ
        console.error('[CHATBOT ERROR] Lỗi ngoài dự kiến:', err.message)
        console.error('[CHATBOT ERROR] Stack:', err.stack)
        // Trả 200 với fallback thay vì 500 để UI không hiện lỗi đỏ
        return res.status(200).json({
            success: false,
            reply: '⚠️ Đã xảy ra sự cố không mong muốn. Vui lòng thử lại hoặc hỏi câu khác.',
            intent: 'ERROR',
            suggestAreas: true,
            expertNodes: [],
            fromCache: false,
            elapsed_ms: Date.now() - startedAt
        })
    }
})

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 2 – POST /api/v1/chatbot/expert-detail  (Tầng 2)
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/chatbot/expert-detail', async (req, res) => {
    const startedAt = Date.now()

    try {
        const { node_id, question } = req.body || {}

        if (!node_id) {
            return res.status(400).json({
                success: false,
                message: 'Thiếu node_id để phân tích chi tiết.'
            })
        }

        const cacheKey = `ucbot:expert:${node_id}`
        if (redis) {
            try {
                const hit = await redis.get(cacheKey)
                if (hit) {
                    const data = JSON.parse(hit)
                    data.elapsed_ms = Date.now() - startedAt
                    data.source = 'cache'
                    return res.json({ success: true, data })
                }
            } catch (_) { }
        }

        let feature = null

        if (typeof getFeatureByGridId === 'function') {
            try {
                feature = await getFeatureByGridId(node_id)
            } catch (err) {
                console.error('[ExpertDetail] getFeatureByGridId lỗi:', err.message)
            }
        }

        if (!feature) {
            return res.status(200).json({
                success: true,
                data: {
                    answer:
                        `⚠️ Hiện chưa lấy được dữ liệu chi tiết cho node ${node_id}.\n\n` +
                        `Nguyên nhân thường gặp:\n` +
                        `- node_id không tồn tại trong hệ thống\n` +
                        `- Không có dữ liệu thời tiết cho khu vực này\n\n` +
                        `Vui lòng thử lại với khu vực khác. Thời gian xử lý: ${Date.now() - startedAt}ms.`,
                    node_id,
                    risk_level: null,
                    flood_depth_cm: null,
                    source: 'fallback'
                }
            })
        }

        const featureVector = buildFeatureVector(feature)

        let aiResult = null
        let source = 'fallback'
        const aiResponse = await callAIService(featureVector)

        if (aiResponse && !aiResponse.timedOut && aiResponse.data) {
            aiResult = aiResponse.data
            source = 'ai_realtime'
        } else {
            // Fallback to precomputed cron data from feature object if available
            aiResult = {
                flood_depth_cm: feature.flood_depth_cm,
                risk_level: feature.risk_level
            }
            source = 'db_cron'
        }

        const reportText = buildExpertReport(question || 'Phân tích tổng quát', featureVector, feature, aiResult)

        const responseData = {
            answer: reportText,
            node_id,
            risk_level: aiResult?.risk_level ?? feature.risk_level,
            flood_depth_cm: aiResult?.flood_depth_cm ?? feature.flood_depth_cm,
            location_name: feature.location_name,
            source,
        }

        if (redis) {
            try {
                await redis.setEx(cacheKey, CACHE_TTL_EXPERT, JSON.stringify(responseData))
            } catch (_) { }
        }

        responseData.elapsed_ms = Date.now() - startedAt
        return res.json({ success: true, data: responseData })

    } catch (err) {
        console.error('[ExpertDetail] lỗi:', err)
        return res.status(500).json({
            success: false,
            message: err.message || 'Lỗi phân tích AI chi tiết'
        })
    }
})

module.exports = { unifiedChatbotRouter: router }