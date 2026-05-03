'use strict'
const axios = require('axios')
const express = require('express')
const { QueryTypes } = require('sequelize')
const { sequelize } = require('../db/sequelize')
const { explainWithAI } = require('../services/aiExplain.service')
const router = express.Router()

const TZ = 'Asia/Ho_Chi_Minh'
const FORECAST_HOURS = 96
const GEOCODE_CACHE = new Map()

function normalizeText(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractPlaceNameFromMessage(message) {
  let text = normalizeText(message)

  const removeWords = [
    'vi sao',
    'tai sao',
    'nguyen nhan',
    'giai thich',
    'ly do',
    'tinh hinh ngap cua khu vuc',
    'tinh trang ngap cua khu vuc',
    'tinh hinh ngap',
    'tinh trang ngap',
    'khu vuc',
    'co nguy co cao',
    'nguy co cao',
    'ngap',
    'hien tai',
    'bay gio',
    'ha noi',
  ]

  for (const word of removeWords) {
    text = text.replaceAll(word, '')
  }

  return text.replace(/\s+/g, ' ').trim()
}
async function queryAreaByPlaceName(message) {
  const placeName = extractPlaceNameFromMessage(message)

  console.log('[Chatbot] Original message:', message)
  console.log('[Chatbot] Place extracted:', placeName)

  // 1. Thử tìm trực tiếp trong DB theo location_name, grid_id, node_id
  const directRows = await queryForExplanation(placeName)

  if (directRows.length > 0) {
    return directRows
  }

  // 2. Nếu DB không có tên địa danh, gọi geocoding lấy tọa độ
  const geo = await geocodePlaceInHanoi(placeName)

  if (!geo) {
    return []
  }

  // 3. Tìm grid_node gần nhất với tọa độ địa danh
  const sql = `
    SELECT
      fp.node_id,
      fp.risk_level::text AS risk_level,
      fp.flood_depth_cm,
      fp.explanation,
      fp.time,

      gn.location_name,
      gn.grid_id,
      gn.latitude,
      gn.longitude,
      gn.elevation,
      gn.slope,
      gn.impervious_ratio,
      gn.dist_to_drain_km,
      gn.dist_to_river_km,
      gn.dist_to_pump_km,
      gn.dist_to_main_road_km,
      gn.dist_to_park_km,

      wm.temp,
      wm.rhum,
      wm.prcp,
      wm.prcp_3h,
      wm.prcp_6h,
      wm.prcp_12h,
      wm.prcp_24h,
      wm.wspd,
      wm.pres,
      wm.pressure_change_24h,
      wm.max_prcp_3h,
      wm.max_prcp_6h,
      wm.max_prcp_12h,
      wm.month,
      wm.hour,
      wm.rainy_season_flag,

      :place_name AS input_place_name,
      :display_name AS geocode_display_name,

      (
        6371 * acos(
          LEAST(1, GREATEST(-1,
            cos(radians(:lat)) * cos(radians(gn.latitude)) *
            cos(radians(gn.longitude) - radians(:lon)) +
            sin(radians(:lat)) * sin(radians(gn.latitude))
          ))
        )
      ) AS distance_km

    FROM grid_nodes gn

    LEFT JOIN LATERAL (
      SELECT *
      FROM flood_predictions fp
      WHERE fp.node_id = gn.node_id
      ORDER BY fp.time DESC
      LIMIT 1
    ) fp ON true

    LEFT JOIN LATERAL (
      SELECT *
      FROM weather_measurements wm
      WHERE wm.node_id = gn.node_id
      ORDER BY wm.time DESC
      LIMIT 1
    ) wm ON true

    WHERE fp.prediction_id IS NOT NULL

    ORDER BY distance_km ASC
    LIMIT 5
  `

  return sequelize.query(sql, {
    type: QueryTypes.SELECT,
    replacements: {
      lat: geo.latitude,
      lon: geo.longitude,
      place_name: geo.place_name,
      display_name: geo.display_name,
    },
  })
}

async function geocodePlaceInHanoi(placeName) {
  const cleanPlace = String(placeName || '').trim()

  if (!cleanPlace) return null

  const cacheKey = normalizeText(cleanPlace)

  if (GEOCODE_CACHE.has(cacheKey)) {
    return GEOCODE_CACHE.get(cacheKey)
  }

  const q = `${cleanPlace}, Hà Nội, Việt Nam`

  const res = await axios.get('https://nominatim.openstreetmap.org/search', {
    params: {
      q,
      format: 'json',
      limit: 1,
      countrycodes: 'vn',
      addressdetails: 1,
    },
    headers: {
      'User-Agent': 'AquaAlert-FloodPrediction/1.0',
    },
    timeout: 8000,
  })

  const item = Array.isArray(res.data) ? res.data[0] : null

  if (!item) return null

  const result = {
    place_name: cleanPlace,
    display_name: item.display_name,
    latitude: Number(item.lat),
    longitude: Number(item.lon),
  }

  GEOCODE_CACHE.set(cacheKey, result)

  return result
}

function extractPlaceNameFromMessage(message) {
  let text = normalizeText(message)

  const patterns = [
    /(?:o|tai|den|gan)\s+(.+)$/,
    /(?:khu vuc)\s+(.+?)(?:\s+co\s+nguy\s+co|\s+nguy\s+co|\s+bi\s+ngap|$)/,
    /(?:cua khu vuc)\s+(.+)$/,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match && match[1]) {
      text = match[1]
      break
    }
  }

  const removeWords = [
    'vi sao',
    'tai sao',
    'nguyen nhan',
    'giai thich',
    'ly do',
    'tinh hinh ngap cua khu vuc',
    'tinh trang ngap cua khu vuc',
    'tinh hinh ngap',
    'tinh trang ngap',
    'trong 12h toi',
    'trong 24h toi',
    'trong 6h toi',
    '12h toi',
    '24h toi',
    '6h toi',
    'hien tai',
    'bay gio',
    'khu vuc',
    'co nguy co cao',
    'nguy co cao',
    'ngap',
    'ha noi',
  ]

  for (const word of removeWords) {
    text = text.replaceAll(word, '')
  }

  return text.replace(/\s+/g, ' ').trim()
}

async function geocodePlaceInHanoi(placeName) {
  const cleanPlace = String(placeName || '').trim()

  if (!cleanPlace) return null

  const cacheKey = normalizeText(cleanPlace)
  if (GEOCODE_CACHE.has(cacheKey)) {
    return GEOCODE_CACHE.get(cacheKey)
  }

  const q = `${cleanPlace}, Hà Nội, Việt Nam`

  const res = await axios.get('https://nominatim.openstreetmap.org/search', {
    params: {
      q,
      format: 'json',
      limit: 1,
      countrycodes: 'vn',
      addressdetails: 1,
    },
    headers: {
      // Nên đổi thành email/project thật của bạn khi deploy
      'User-Agent': 'AquaAlert-FloodPrediction/1.0',
    },
    timeout: 8000,
  })

  const item = Array.isArray(res.data) ? res.data[0] : null

  if (!item) return null

  const result = {
    place_name: cleanPlace,
    display_name: item.display_name,
    latitude: Number(item.lat),
    longitude: Number(item.lon),
  }

  GEOCODE_CACHE.set(cacheKey, result)
  return result
}

function formatVN(dt) {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: TZ,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(dt))
}

const RISK_LABEL = {
  safe: 'An toàn',
  medium: 'Nguy cơ thấp',
  high: 'Nguy cơ cao',
  severe: 'Nguy hiểm nghiêm trọng',
}

const RISK_EMOJI = {
  safe: '🟢',
  medium: '🟡',
  high: '🟠',
  severe: '🔴',
}

function riskLabel(level) {
  return `${RISK_EMOJI[level] ?? '⚪'} ${RISK_LABEL[level] ?? level ?? 'Không xác định'}`
}

function detectIntent(msg) {
  const m = normalizeText(msg)

  if (/\b(xin chao|hello|hi|chao bot|chao aqua)\b/.test(m)) return 'GREETING'

  if (/(vi sao|tai sao|nguyen nhan|giai thich|ly do|sao lai|vi ly do gi)/.test(m)) {
    return 'EXPLAIN_RISK'
  }

  if (/(khu vuc nao|dau nguy hiem|nang nhat|nguy hiem nhat|khu nao ngap|ngap nang)/.test(m)) {
    return 'WORST_AREA'
  }

  if (/(tinh hinh ngap|tinh trang ngap|ngap cua khu vuc|khu vuc .* ngap|ngap o|ngap tai)/.test(m)) {
    return 'AREA_STATUS'
  }

  if (/(\d{1,2}h|\d{1,2}:\d{2}|sang|chieu|toi|trua|ngay mai|hom nay|ngay kia)/.test(m) &&
      /(ngap|mua|lu|du bao|nguy co)/.test(m)) {
    return 'SPECIFIC_TIME'
  }

  if (/(hien tai|bay gio|dang ngap|luc nay|ngay bay gio|hien gio)/.test(m)) {
    return 'CURRENT_STATUS'
  }

  if (/(an toan khong|co an toan khong|nen di khong|co nen di khong|co nen ra ngoai khong|nen ra ngoai khong|co the ra|co the ra ngoai|nen o nha|nguy hiem khong|toi nen lam gi|nen lam gi tiep|lam gi tiep theo|can lam gi)/.test(m)) {
  return 'SAFE_ADVICE'
}

  if (/(du bao|ngap lut|lu lut|4 ngay|96 gio|tuan|sap toi|trong thoi gian)/.test(m)) {
    return 'FORECAST_4DAYS'
  }

  return 'UNKNOWN'
}

function extractKeyword(message) {
  return message
    .replace(/vì sao/gi, '')
    .replace(/tại sao/gi, '')
    .replace(/nguyên nhân/gi, '')
    .replace(/giải thích/gi, '')
    .replace(/khu vực/gi, '')
    .replace(/ngập/gi, '')
    .replace(/nguy cơ/gi, '')
    .replace(/cao/gi, '')
    .replace(/[?.!,]/g, '')
    .trim()
}

function buildSafeFeatures(r) {
  const time = r.time ? new Date(r.time) : new Date()

  const hour = Number(r.hour ?? time.getHours())
  const month = Number(r.month ?? time.getMonth() + 1)

  const startOfYear = new Date(time.getFullYear(), 0, 0)
  const dayofyear = Math.floor((time - startOfYear) / (1000 * 60 * 60 * 24))
  const dayofweek = time.getDay()

  return {
    prcp: Number(r.prcp ?? 0),
    prcp_3h: Number(r.prcp_3h ?? 0),
    prcp_6h: Number(r.prcp_6h ?? 0),
    prcp_12h: Number(r.prcp_12h ?? 0),
    prcp_24h: Number(r.prcp_24h ?? 0),

    temp: Number(r.temp ?? 0),
    rhum: Number(r.rhum ?? 0),
    wspd: Number(r.wspd ?? 0),
    pres: Number(r.pres ?? 0),
    pressure_change_24h: Number(r.pressure_change_24h ?? 0),

    max_prcp_3h: Number(r.max_prcp_3h ?? 0),
    max_prcp_6h: Number(r.max_prcp_6h ?? 0),
    max_prcp_12h: Number(r.max_prcp_12h ?? 0),

    elevation: Number(r.elevation ?? 0),
    slope: Number(r.slope ?? 0),
    impervious_ratio: Number(r.impervious_ratio ?? 0),

    dist_to_drain_km: Number(r.dist_to_drain_km ?? 0),
    dist_to_river_km: Number(r.dist_to_river_km ?? 0),
    dist_to_pump_km: Number(r.dist_to_pump_km ?? 0),
    dist_to_main_road_km: Number(r.dist_to_main_road_km ?? 0),
    dist_to_park_km: Number(r.dist_to_park_km ?? 0),

    hour,
    dayofweek,
    month,
    dayofyear,

    hour_sin: Math.sin((2 * Math.PI * hour) / 24),
    hour_cos: Math.cos((2 * Math.PI * hour) / 24),
    month_sin: Math.sin((2 * Math.PI * month) / 12),
    month_cos: Math.cos((2 * Math.PI * month) / 12),

    rainy_season_flag: r.rainy_season_flag === true ? 1 : 0,
  }
}

function buildReasonList(row) {
  const f = buildSafeFeatures(row)
  const reasons = []

  if (f.prcp_24h >= 100) reasons.push(`Mưa tích lũy 24h cao: **${f.prcp_24h} mm**`)
  if (f.prcp_6h >= 60) reasons.push(`Mưa 6h gần đây lớn: **${f.prcp_6h} mm**`)
  if (f.max_prcp_3h >= 30) reasons.push(`Cường độ mưa cực đại 3h cao: **${f.max_prcp_3h} mm**`)
  if (f.elevation <= 1.5) reasons.push(`Cao độ địa hình thấp: **${f.elevation} m**`)
  if (f.slope <= 1) reasons.push(`Độ dốc nhỏ: **${f.slope}**, nước thoát chậm`)
  if (f.impervious_ratio >= 0.7) reasons.push(`Tỷ lệ bê tông hóa cao: **${f.impervious_ratio}**`)
  if (f.dist_to_drain_km <= 0.3) reasons.push(`Gần hệ thống thoát nước: **${f.dist_to_drain_km} km**, dễ quá tải`)
  if (f.dist_to_river_km <= 0.5) reasons.push(`Gần sông/kênh rạch: **${f.dist_to_river_km} km**`)
  if (f.rainy_season_flag === 1) reasons.push('Đang trong mùa mưa')

  return { features: f, reasons }
}

async function queryForecastSummary() {
  const sql = `
    SELECT
      fp.risk_level::text AS risk_level,
      COUNT(DISTINCT fp.node_id) AS node_count,
      MIN(fp.flood_depth_cm) AS min_depth,
      MAX(fp.flood_depth_cm) AS max_depth,
      AVG(fp.flood_depth_cm) AS avg_depth
    FROM flood_predictions fp
    WHERE fp.time BETWEEN NOW() AND NOW() + INTERVAL '${FORECAST_HOURS} hours'
    GROUP BY fp.risk_level
    ORDER BY
      CASE fp.risk_level::text
        WHEN 'severe' THEN 4
        WHEN 'high' THEN 3
        WHEN 'medium' THEN 2
        WHEN 'safe' THEN 1
        ELSE 0
      END DESC
  `
  return sequelize.query(sql, { type: QueryTypes.SELECT })
}

async function queryCurrentStatus() {
  const sql = `
    SELECT
      fp.node_id,
      fp.risk_level::text AS risk_level,
      fp.flood_depth_cm,
      fp.explanation,
      fp.time,

      gn.location_name,
      gn.latitude,
      gn.longitude,
      gn.elevation,
      gn.slope,
      gn.impervious_ratio,
      gn.dist_to_drain_km,
      gn.dist_to_river_km,
      gn.dist_to_pump_km,
      gn.dist_to_main_road_km,
      gn.dist_to_park_km,

      wm.temp,
      wm.rhum,
      wm.prcp,
      wm.prcp_3h,
      wm.prcp_6h,
      wm.prcp_12h,
      wm.prcp_24h,
      wm.wspd,
      wm.pres,
      wm.pressure_change_24h,
      wm.max_prcp_3h,
      wm.max_prcp_6h,
      wm.max_prcp_12h,
      wm.month,
      wm.hour,
      wm.rainy_season_flag
    FROM flood_predictions fp
    JOIN grid_nodes gn ON gn.node_id = fp.node_id
    LEFT JOIN LATERAL (
      SELECT *
      FROM weather_measurements wm
      WHERE wm.node_id = fp.node_id
      ORDER BY ABS(EXTRACT(EPOCH FROM (wm.time - fp.time))) ASC
      LIMIT 1
    ) wm ON true
    WHERE fp.time BETWEEN NOW() - INTERVAL '30 minutes'
                      AND NOW() + INTERVAL '30 minutes'
    ORDER BY fp.flood_depth_cm DESC NULLS LAST
    LIMIT 10
  `
  return sequelize.query(sql, { type: QueryTypes.SELECT })
}

async function queryWorstArea() {
  const sql = `
    SELECT
      fp.node_id,
      fp.risk_level::text AS risk_level,
      fp.flood_depth_cm,
      fp.explanation,
      fp.time,

      gn.location_name,
      gn.latitude,
      gn.longitude,
      gn.elevation,
      gn.slope,
      gn.impervious_ratio,
      gn.dist_to_drain_km,
      gn.dist_to_river_km,
      gn.dist_to_pump_km,
      gn.dist_to_main_road_km,
      gn.dist_to_park_km,

      wm.temp,
      wm.rhum,
      wm.prcp,
      wm.prcp_3h,
      wm.prcp_6h,
      wm.prcp_12h,
      wm.prcp_24h,
      wm.wspd,
      wm.pres,
      wm.pressure_change_24h,
      wm.max_prcp_3h,
      wm.max_prcp_6h,
      wm.max_prcp_12h,
      wm.month,
      wm.hour,
      wm.rainy_season_flag
    FROM flood_predictions fp
    JOIN grid_nodes gn ON gn.node_id = fp.node_id
    LEFT JOIN LATERAL (
      SELECT *
      FROM weather_measurements wm
      WHERE wm.node_id = fp.node_id
      ORDER BY ABS(EXTRACT(EPOCH FROM (wm.time - fp.time))) ASC
      LIMIT 1
    ) wm ON true
    WHERE fp.time BETWEEN NOW() AND NOW() + INTERVAL '${FORECAST_HOURS} hours'
    ORDER BY fp.flood_depth_cm DESC NULLS LAST
    LIMIT 5
  `
  return sequelize.query(sql, { type: QueryTypes.SELECT })
}

async function queryByTime(hoursOffset) {
  const sql = `
    SELECT
      fp.node_id,
      fp.risk_level::text AS risk_level,
      fp.flood_depth_cm,
      fp.explanation,
      fp.time,
      gn.location_name
    FROM flood_predictions fp
    JOIN grid_nodes gn ON gn.node_id = fp.node_id
    WHERE fp.time BETWEEN (NOW() + INTERVAL '${hoursOffset} hours')
                      AND (NOW() + INTERVAL '${hoursOffset + 2} hours')
    ORDER BY fp.flood_depth_cm DESC NULLS LAST
    LIMIT 10
  `
  return sequelize.query(sql, { type: QueryTypes.SELECT })
}

async function queryForExplanation(keyword) {
  const replacements = {}

  let whereKeyword = ''
  if (keyword) {
    replacements.keyword = `%${keyword}%`
    replacements.node_id = Number(keyword) || -1

    whereKeyword = `
      AND (
        LOWER(COALESCE(gn.location_name, '')) LIKE LOWER(:keyword)
        OR LOWER(COALESCE(gn.grid_id, '')) LIKE LOWER(:keyword)
        OR gn.node_id = :node_id
      )
    `
  }

  const sql = `
    SELECT
      fp.node_id,
      fp.risk_level::text AS risk_level,
      fp.flood_depth_cm,
      fp.explanation,
      fp.time,

      gn.location_name,
      gn.grid_id,
      gn.latitude,
      gn.longitude,
      gn.elevation,
      gn.slope,
      gn.impervious_ratio,
      gn.dist_to_drain_km,
      gn.dist_to_river_km,
      gn.dist_to_pump_km,
      gn.dist_to_main_road_km,
      gn.dist_to_park_km,

      wm.temp,
      wm.rhum,
      wm.prcp,
      wm.prcp_3h,
      wm.prcp_6h,
      wm.prcp_12h,
      wm.prcp_24h,
      wm.wspd,
      wm.pres,
      wm.pressure_change_24h,
      wm.max_prcp_3h,
      wm.max_prcp_6h,
      wm.max_prcp_12h,
      wm.month,
      wm.hour,
      wm.rainy_season_flag
    FROM flood_predictions fp
    JOIN grid_nodes gn ON gn.node_id = fp.node_id
    LEFT JOIN LATERAL (
      SELECT *
      FROM weather_measurements wm
      WHERE wm.node_id = fp.node_id
      ORDER BY ABS(EXTRACT(EPOCH FROM (wm.time - fp.time))) ASC
      LIMIT 1
    ) wm ON true
    WHERE fp.time BETWEEN NOW() AND NOW() + INTERVAL '24 hours'
    ${whereKeyword}
    ORDER BY fp.flood_depth_cm DESC NULLS LAST
    LIMIT 5
  `

  return sequelize.query(sql, {
    type: QueryTypes.SELECT,
    replacements,
  })
}

async function queryForecastByTimeSteps(nodeId, forecastHours = 12) {
  const sql = `
    SELECT
      fp.time,
      fp.risk_level::text AS risk_level,
      fp.flood_depth_cm,
      fp.explanation,

      wm.prcp,
      wm.prcp_3h,
      wm.prcp_6h,
      wm.prcp_12h,
      wm.prcp_24h,
      wm.temp,
      wm.rhum,
      wm.wspd,
      wm.pres,
      wm.pressure_change_24h,
      wm.max_prcp_3h,
      wm.max_prcp_6h,
      wm.max_prcp_12h,
      wm.rainy_season_flag
    FROM flood_predictions fp
    LEFT JOIN LATERAL (
      SELECT *
      FROM weather_measurements wm
      WHERE wm.node_id = fp.node_id
      ORDER BY ABS(EXTRACT(EPOCH FROM (wm.time - fp.time))) ASC
      LIMIT 1
    ) wm ON true
    WHERE fp.node_id = :node_id
      AND fp.time BETWEEN NOW() - INTERVAL '3 hours'
                      AND NOW() + (:forecast_hours * INTERVAL '1 hour')
    ORDER BY fp.time ASC
  `

  return sequelize.query(sql, {
    type: QueryTypes.SELECT,
    replacements: {
      node_id: nodeId,
      forecast_hours: forecastHours,
    },
  })
}

function buildTimelineResponse(rows, forecastHours = 12) {
  if (!rows.length) {
    return `## Dự báo ngập theo từng mốc 3 giờ\n\n📭 Chưa có dữ liệu dự báo trong ${forecastHours} giờ tới cho khu vực này.`
  }

  const now = new Date()
  const buckets = []

  for (let start = 0; start < forecastHours; start += 3) {
    const end = start + 3

    const bucketRows = rows.filter(r => {
      const diffHour = (new Date(r.time) - now) / 3600000

      // Cho phép mốc gần hiện tại lệch nhẹ về quá khứ
      if (start === 0) {
        return diffHour >= -3 && diffHour < 3
      }

      return diffHour >= start && diffHour < end
    })

    if (!bucketRows.length) continue

    const avg = (key) => {
      const values = bucketRows.map(r => Number(r[key] || 0))
      return values.reduce((a, b) => a + b, 0) / values.length
    }

    const max = (key) => {
      return Math.max(...bucketRows.map(r => Number(r[key] || 0)))
    }

    const worstRow = bucketRows
      .slice()
      .sort((a, b) => Number(b.flood_depth_cm || 0) - Number(a.flood_depth_cm || 0))[0]

    buckets.push({
      label: `Trong ${end} giờ tới`,
      time: worstRow.time,
      risk_level: worstRow.risk_level,
      max_depth: max('flood_depth_cm'),
      avg_prcp: avg('prcp'),
      avg_prcp_3h: avg('prcp_3h'),
      avg_prcp_6h: avg('prcp_6h'),
      avg_prcp_12h: avg('prcp_12h'),
      avg_prcp_24h: avg('prcp_24h'),
      avg_temp: avg('temp'),
      avg_rhum: avg('rhum'),
      avg_wspd: avg('wspd'),
      avg_pres: avg('pres'),
      max_prcp_3h: max('max_prcp_3h'),
      max_prcp_6h: max('max_prcp_6h'),
      max_prcp_12h: max('max_prcp_12h'),
      explanation: worstRow.explanation,
    })
  }

  if (!buckets.length) {
    return `## Dự báo ngập theo từng mốc 3 giờ\n\n📭 Có dữ liệu node nhưng chưa có bản ghi dự báo phù hợp trong ${forecastHours} giờ tới.`
  }

  const mostDangerous = buckets
    .slice()
    .sort((a, b) => Number(b.max_depth || 0) - Number(a.max_depth || 0))[0]

  let msg = `## Dự báo ngập theo từng mốc 3 giờ\n\n`

  msg += `🚨 **Mốc cần chú ý nhất:** ${mostDangerous.label}\n`
  msg += `- Nguy cơ: **${riskLabel(mostDangerous.risk_level)}**\n`
  msg += `- Độ sâu ngập lớn nhất: **${Number(mostDangerous.max_depth).toFixed(1)} cm**\n\n`

  msg += `---\n\n`

  buckets.forEach(b => {
    const isDanger =
      b === mostDangerous ||
      Number(b.max_depth || 0) >= 20 ||
      ['high', 'severe'].includes(b.risk_level)

    msg += `### ${isDanger ? '🚨 ' : ''}${b.label}\n\n`

    if (isDanger) {
      msg += `🚨 **Cảnh báo: Đây là mốc có nguy cơ cần chú ý.**\n\n`
    }

    msg += `- Thời điểm đại diện: **${formatVN(b.time)}**\n`
    msg += `- Nguy cơ ngập: **${riskLabel(b.risk_level)}**\n`
    msg += `- Độ sâu ngập lớn nhất: **${Number(b.max_depth).toFixed(1)} cm**\n\n`

    msg += `**Nhóm thời tiết:**\n`
    msg += `- Mưa hiện tại trung bình: **${b.avg_prcp.toFixed(2)} mm**\n`
    msg += `- Mưa tích lũy 3h: **${b.avg_prcp_3h.toFixed(2)} mm**\n`
    msg += `- Mưa tích lũy 6h: **${b.avg_prcp_6h.toFixed(2)} mm**\n`
    msg += `- Mưa tích lũy 12h: **${b.avg_prcp_12h.toFixed(2)} mm**\n`
    msg += `- Mưa tích lũy 24h: **${b.avg_prcp_24h.toFixed(2)} mm**\n`
    msg += `- Mưa cực đại 3h: **${b.max_prcp_3h.toFixed(2)} mm**\n`
    msg += `- Mưa cực đại 6h: **${b.max_prcp_6h.toFixed(2)} mm**\n`
    msg += `- Mưa cực đại 12h: **${b.max_prcp_12h.toFixed(2)} mm**\n`
    msg += `- Nhiệt độ: **${b.avg_temp.toFixed(1)}°C**\n`
    msg += `- Độ ẩm: **${b.avg_rhum.toFixed(0)}%**\n`
    msg += `- Gió: **${b.avg_wspd.toFixed(1)} km/h**\n`
    msg += `- Áp suất: **${b.avg_pres.toFixed(1)} hPa**\n\n`

    msg += `**Khả năng ngập lụt:**\n`

    if (b.max_depth >= 50 || b.risk_level === 'severe') {
      msg += `- Nguy cơ rất cao, không nên di chuyển qua khu vực này nếu không cần thiết.\n\n`
    } else if (b.max_depth >= 20 || b.risk_level === 'high') {
      msg += `- Nguy cơ cao, nên hạn chế di chuyển và tránh vùng trũng thấp.\n\n`
    } else if (b.max_depth >= 5 || b.risk_level === 'medium') {
      msg += `- Có khả năng ngập nhẹ đến trung bình, cần theo dõi thêm.\n\n`
    } else {
      msg += `- Tạm thời chưa có cảnh báo ngập đáng kể.\n\n`
    }
  })

  return msg.trim()
}

function replyGreeting() {
  return `👋 Xin chào! Tôi là **AQUA Bot**.

Tôi có thể giúp bạn:
- Dự báo nguy cơ ngập lụt
- Xác định khu vực nguy hiểm nhất
- Giải thích vì sao khu vực có nguy cơ cao
- Tư vấn an toàn khi có cảnh báo`
}

function replyForecast(rows) {
  if (!rows.length) {
    return '📭 Hiện chưa có dữ liệu dự báo trong DB.'
  }

  const lines = rows.map(r => {
    return `${riskLabel(r.risk_level)}: **${r.node_count} điểm đo**, TB **${Number(r.avg_depth || 0).toFixed(1)}cm**, max **${Number(r.max_depth || 0).toFixed(1)}cm**`
  })

  return `📊 **Dự báo ngập lụt 4 ngày tới:**\n\n${lines.join('\n')}`
}

function replyCurrentStatus(rows) {
  if (!rows.length) {
    return '✅ Hiện chưa có dữ liệu dự báo gần thời điểm hiện tại.'
  }

  const worst = rows[0]

  let msg = `🕐 **Tình trạng hiện tại (${formatVN(new Date())}):**\n\n`
  msg += `Khu vực rủi ro cao nhất: **${worst.location_name || `Node ${worst.node_id}`}**\n`
  msg += `Mức rủi ro: **${riskLabel(worst.risk_level)}**\n`
  msg += `Độ sâu ngập dự báo: **${Number(worst.flood_depth_cm || 0).toFixed(1)}cm**\n`

  if (worst.explanation) {
    msg += `\n💬 ${worst.explanation}`
  }

  return msg
}

function replyWorstArea(rows) {
  if (!rows.length) {
    return '✅ Trong 4 ngày tới chưa có dữ liệu khu vực nguy hiểm.'
  }

  let msg = `🚨 **Top khu vực nguy cơ cao nhất:**\n\n`

  rows.forEach((r, i) => {
    msg += `**${i + 1}. ${r.location_name || `Node ${r.node_id}`}**\n`
    msg += `- Mức rủi ro: ${riskLabel(r.risk_level)}\n`
    msg += `- Độ sâu dự báo: **${Number(r.flood_depth_cm || 0).toFixed(1)}cm**\n`
    msg += `- Thời điểm: ${formatVN(r.time)}\n`
    msg += `- Tọa độ: ${Number(r.latitude).toFixed(4)}, ${Number(r.longitude).toFixed(4)}\n\n`
  })

  return msg.trim()
}

function calculateInternalRiskScore(f) {
  let score = 0
  const reasons = []

  if (f.prcp >= 20) {
    score += 1
    reasons.push(`mưa hiện tại đạt **${f.prcp} mm**, cho thấy đang có mưa đáng kể.`)
  }

  if (f.prcp_3h >= 50) {
    score += 2
    reasons.push(`mưa 3 giờ gần nhất đạt **${f.prcp_3h} mm**, cho thấy cường độ mưa ngắn hạn lớn.`)
  }

  if (f.prcp_6h >= 80) {
    score += 2
    reasons.push(`mưa 6 giờ đạt **${f.prcp_6h} mm**, nghĩa là nước mưa tích lũy liên tục trong nhiều giờ.`)
  }

  if (f.prcp_24h >= 120) {
    score += 2
    reasons.push(`tổng mưa 24 giờ đạt **${f.prcp_24h} mm**, làm hệ thống thoát nước dễ bị quá tải.`)
  }

  if (f.elevation <= 6) {
    score += 1
    reasons.push(`cao độ chỉ khoảng **${f.elevation} m**, đây là vùng thấp nên nước dễ dồn về.`)
  }

  if (f.slope <= 2) {
    score += 1
    reasons.push(`độ dốc khoảng **${f.slope}**, nước chảy chậm và dễ lưu lại trên bề mặt.`)
  }

  if (f.impervious_ratio >= 0.7) {
    score += 1
    reasons.push(`tỷ lệ bê tông hóa **${f.impervious_ratio}**, nước khó thấm xuống đất và tạo dòng chảy mặt lớn.`)
  }

  if (f.dist_to_drain_km <= 0.4) {
    score += 1
    reasons.push(`khoảng cách tới hệ thống thoát nước chỉ **${f.dist_to_drain_km} km**, có thể là khu vực tập trung dòng chảy hoặc điểm nghẽn thoát nước.`)
  }

  if (f.dist_to_river_km <= 1.5) {
    score += 1
    reasons.push(`khu vực cách sông khoảng **${f.dist_to_river_km} km**, khi mưa lớn có thể chịu ảnh hưởng bởi mực nước sông hoặc thoát nước chậm.`)
  }

  if (f.rainy_season_flag === 1) {
    score += 1
    reasons.push(`thời điểm hiện tại nằm trong mùa mưa, xác suất xuất hiện mưa lớn và ngập cục bộ cao hơn.`)
  }

  return {
    score: Math.min(score, 12),
    maxScore: 12,
    reasons,
  }
}

function getRiskText(score) {
  if (score >= 10) return 'RẤT CAO'
  if (score >= 7) return 'CAO'
  if (score >= 4) return 'TRUNG BÌNH'
  return 'THẤP'
}

async function replyExplanation(rows) {
  if (!rows.length) {
    return '🔍 Tôi chưa tìm thấy khu vực phù hợp để giải thích. Bạn có thể hỏi theo tên khu vực, grid_id hoặc node_id.'
  }

  const r = rows[0]
  const { features } = buildReasonList(r)
  let aiExplain = null

  try {
    aiExplain = await explainWithAI(features)
  } catch (err) {
    console.error('AI explain error:', err.message)
  }

  const risk = calculateInternalRiskScore(features)
  const riskText = getRiskText(risk.score)

  let msg = ''

  msg += `## Đánh giá nhanh:\n\n`
  msg += `- Mức nguy cơ ngập: **${riskText}**\n\n`
  msg += `- Điểm rủi ro nội bộ: **${risk.score}/${risk.maxScore}**\n\n`

  msg += `📍 **Khu vực:** ${r.location_name || `Node ${r.node_id}`}\n`

  if (r.input_place_name) {
    msg += `🔎 **Địa danh bạn nhập:** ${r.input_place_name}\n`
  }

  if (r.geocode_display_name) {
    msg += `🗺️ **Đã map tới tọa độ:** ${r.geocode_display_name}\n`
  }

  if (r.distance_km !== undefined) {
    msg += `🧭 **Node gần nhất:** Node ${r.node_id}, cách địa danh khoảng **${Number(r.distance_km).toFixed(2)} km**\n`
  }

  msg += `🌊 **Độ sâu ngập dự báo:** **${Number(r.flood_depth_cm || 0).toFixed(1)} cm**\n`
  msg += `⏰ **Thời điểm dự báo:** ${formatVN(r.time)}\n\n`

  msg += `## Vì sao khu vực này có nguy cơ ngập?\n\n`

  if (risk.reasons.length) {
    risk.reasons.forEach((reason, index) => {
      msg += `${index + 1}. ${reason}\n\n`
    })
  } else {
    msg += `Hiện chưa có yếu tố đơn lẻ nào vượt ngưỡng mạnh, nhưng mô hình vẫn đánh giá dựa trên tổ hợp các biến mưa, địa hình, đô thị hóa, thoát nước và thời gian.\n\n`
  }

  msg += `## Phân tích chuyên sâu:\n\n`

  msg += `### 1. Nhóm yếu tố mưa\n\n`
  msg += `Mưa hiện tại là **${features.prcp} mm**, mưa 3 giờ là **${features.prcp_3h} mm**, mưa 6 giờ là **${features.prcp_6h} mm** và mưa 24 giờ là **${features.prcp_24h} mm**. `
  msg += `Nếu mưa lớn kéo dài trong 3 đến 6 giờ, nước chưa kịp thoát sẽ tích tụ trên mặt đường. Khi tổng mưa 24 giờ cao, đất và hệ thống thoát nước đã gần bão hòa, nên chỉ cần thêm một trận mưa ngắn cũng có thể gây ngập.\n\n`

  msg += `### 2. Nhóm yếu tố địa hình\n\n`
  msg += `Cao độ khu vực là **${features.elevation} m** và độ dốc là **${features.slope}**. `
  msg += `Vùng có cao độ thấp thường là nơi nước từ các khu vực cao hơn chảy về. Nếu độ dốc nhỏ, nước chảy chậm, thời gian lưu nước trên bề mặt lâu hơn và nguy cơ ngập tăng.\n\n`

  msg += `### 3. Nhóm yếu tố đô thị hóa\n\n`
  msg += `Tỷ lệ bê tông hóa là **${features.impervious_ratio}**. `
  msg += `Khi tỷ lệ bê tông hóa cao, nước mưa không thấm được xuống đất mà biến thành dòng chảy mặt. Điều này làm tăng áp lực cho cống, mương, kênh thoát nước và dễ gây ngập cục bộ tại các nút giao hoặc khu dân cư thấp.\n\n`

  msg += `### 4. Nhóm yếu tố thoát nước\n\n`
  msg += `Khoảng cách tới hệ thống thoát nước là **${features.dist_to_drain_km} km**, tới sông là **${features.dist_to_river_km} km** và tới trạm bơm là **${features.dist_to_pump_km} km**. `
  msg += `Nếu khu vực gần điểm thoát nước nhưng vẫn có mưa lớn, có thể đây là vùng tập trung nước hoặc nơi hệ thống thoát nước đang quá tải. Nếu xa trạm bơm, khả năng tiêu thoát nước cưỡng bức có thể chậm hơn.\n\n`

  msg += `### 5. Feature important từ mô hình CatBoost\n\n`

if (aiExplain && aiExplain.top_features) {
  aiExplain.top_features.forEach((f, index) => {
    msg += `${index + 1}. **${f.feature}** = ${f.value} → ảnh hưởng: ${f.importance.toFixed(4)}\n`
  })
} else {
  msg += `Không lấy được dữ liệu SHAP từ AI service.\n`
}

  msg += `\n## Kết luận:\n\n`
  msg += `Khu vực này có nguy cơ ngập chủ yếu do sự kết hợp giữa mưa tích lũy lớn, địa hình thấp, bề mặt bê tông hóa cao và khả năng thoát nước có thể bị quá tải. `
  msg += `Đây không phải chỉ do một yếu tố riêng lẻ, mà là kết quả cộng hưởng giữa thời tiết, địa hình và hạ tầng đô thị.\n\n`

  msg += `## Khuyến nghị:\n\n`
  msg += `- Theo dõi thêm lượng mưa trong 1 đến 3 giờ tới.\n\n`
  msg += `- Kiểm tra các điểm trũng, hầm, nút giao và tuyến đường gần khu vực này.\n\n`
  msg += `- Nếu mưa tiếp tục tăng, nên cảnh báo người dân hạn chế di chuyển qua vùng thấp.\n\n`
  msg += `- Không đi qua đoạn đường ngập nếu không rõ độ sâu.\n\n`
  msg += `- Ưu tiên tuyến đường cao, thoáng và tránh khu vực gần sông/kênh rạch khi mưa lớn.\n`

  return msg  
}

function replySafeAdvice(summaryRows) {
  const hasSevereRisk = summaryRows.some(r => r.risk_level === 'severe')
  const hasHighRisk = summaryRows.some(r => r.risk_level === 'high')
  const hasMediumRisk = summaryRows.some(r => r.risk_level === 'medium')

  if (!summaryRows.length) {
    return `📭 Hiện hệ thống chưa có đủ dữ liệu dự báo để đưa ra khuyến nghị chính xác.

Bạn nên:
- Theo dõi bản đồ ngập trong ứng dụng
- Hạn chế đi qua khu vực trũng thấp nếu trời đang mưa
- Hỏi thêm: **"Khu vực nguy hiểm nhất"** hoặc **"Tình trạng ngập hiện tại"**`
  }

  if (!hasSevereRisk && !hasHighRisk && !hasMediumRisk) {
    return `✅ **Có thể ra ngoài, nhưng vẫn nên theo dõi thời tiết.**

Hiện hệ thống chưa ghi nhận khu vực có nguy cơ ngập đáng kể trong dữ liệu dự báo.

Khuyến nghị:
- Có thể di chuyển bình thường
- Mang áo mưa nếu trời có dấu hiệu mưa
- Tránh đi qua hầm chui, đường trũng thấp khi mưa lớn
- Theo dõi bản đồ ngập nếu thời tiết xấu hơn`
  }

  if (hasSevereRisk || hasHighRisk) {
    const severeRow = summaryRows.find(r => r.risk_level === 'severe')
    const highRow = summaryRows.find(r => r.risk_level === 'high')
    const worstRow = severeRow || highRow

    return `⚠️ **Không nên ra ngoài nếu không thật sự cần thiết.**

Hệ thống đang ghi nhận nguy cơ ngập cao trong thời gian tới.

Mức cảnh báo cao nhất: **${riskLabel(worstRow.risk_level)}**
Số điểm ảnh hưởng: **${worstRow.node_count} điểm đo**
Độ sâu ngập lớn nhất dự báo: **${Number(worstRow.max_depth || 0).toFixed(1)}cm**

Bạn nên:
- Hạn chế di chuyển, đặc biệt khi trời mưa lớn
- Tránh vùng trũng, hầm chui, khu vực gần sông/kênh rạch
- Không đi qua đoạn đường ngập nếu không rõ độ sâu
- Theo dõi mục bản đồ ngập trước khi chọn lộ trình
- Hỏi thêm: **"Khu vực nguy hiểm nhất"** để biết nơi cần tránh`
  }

  if (hasMediumRisk) {
    const mediumRow = summaryRows.find(r => r.risk_level === 'medium')

    return `🟡 **Có thể ra ngoài nhưng cần thận trọng.**

Hiện có một số điểm được dự báo ở mức nguy cơ thấp/trung bình.

Số điểm ảnh hưởng: **${mediumRow.node_count} điểm đo**
Độ sâu ngập lớn nhất dự báo: **${Number(mediumRow.max_depth || 0).toFixed(1)}cm**

Bạn nên:
- Ưu tiên tuyến đường chính, tránh đường trũng thấp
- Theo dõi thời tiết trước khi đi
- Không đi qua khu vực nước dâng nhanh
- Hỏi thêm: **"Tình trạng ngập hiện tại"** để kiểm tra trước khi di chuyển`
  }

  return `✅ Hiện chưa có cảnh báo nghiêm trọng. Bạn có thể di chuyển nhưng nên tiếp tục theo dõi tình hình.`
}

function replyUnknown() {
  return `🤔 Tôi chưa hiểu câu hỏi.

Bạn có thể hỏi:
- **"Tình trạng ngập hiện tại"**
- **"Khu vực nguy hiểm nhất"**
- **"Vì sao khu vực X có nguy cơ cao?"**
- **"Dự báo ngập 4 ngày tới thế nào?"**
- **"Có nên ra ngoài không?"**`
}

router.post('/chatbot/ask', async (req, res, next) => {
  try {
    const message = String(req.body?.message || req.body?.question || '').trim()

    if (!message) {
      return res.status(400).json({
        success: false,
        error: { message: 'Vui lòng nhập câu hỏi.' },
      })
    }

    if (message.length > 500) {
      return res.status(400).json({
        success: false,
        error: { message: 'Câu hỏi quá dài, tối đa 500 ký tự.' },
      })
    }

    const intent = detectIntent(message)
    const keyword = extractKeyword(message)

    console.log(`[Chatbot] Intent: ${intent} | Message: "${message.substring(0, 80)}"`)

    let reply = ''
    let data = null

    switch (intent) {
      case 'GREETING':
        reply = replyGreeting()
        break

      case 'FORECAST_4DAYS':
        data = await queryForecastSummary()
        reply = replyForecast(data)
        break

      case 'CURRENT_STATUS':
        data = await queryCurrentStatus()
        reply = replyCurrentStatus(data)
        break

      case 'WORST_AREA':
        data = await queryWorstArea()
        reply = replyWorstArea(data)
        break

      case 'EXPLAIN_RISK':
         data = await queryAreaByPlaceName(message)
         reply = await replyExplanation(data)
         break

      case 'AREA_STATUS':
        data = await queryAreaByPlaceName(message)

        if (!data.length) {
          reply = 'Không tìm thấy khu vực.'
          break
        }
        const nodeId = data[0].node_id
        const forecastHours = 12
        const timelineRows = await queryForecastByTimeSteps(nodeId, forecastHours)
        const timelineMsg = buildTimelineResponse(timelineRows, forecastHours)
        const explainMsg = await replyExplanation(data)
        reply = `${timelineMsg}\n\n---\n\n${explainMsg}`
        break

      case 'SAFE_ADVICE':
        data = await queryForecastSummary()
        reply = replySafeAdvice(data)
        break

      case 'SPECIFIC_TIME': {
        const m = message.toLowerCase()
        let offset = 0

        if (/(ngày mai|tomorrow)/.test(m)) offset = 12
        else if (/(ngày kia|day after)/.test(m)) offset = 36
        else if (/chiều/.test(m)) offset = 6
        else if (/tối/.test(m)) offset = 10

        data = await queryByTime(offset)

        if (!data.length) {
          reply = '📭 Không tìm thấy dữ liệu dự báo cho khoảng thời gian đó.'
        } else {
          const worst = data[0]
          reply = `⏰ **Dự báo lúc ~${formatVN(worst.time)}:**\n\n`
          reply += `Khu vực: **${worst.location_name || `Node ${worst.node_id}`}**\n`
          reply += `Mức nguy hiểm cao nhất: **${riskLabel(worst.risk_level)}**\n`
          reply += `Độ sâu ngập dự báo: **${Number(worst.flood_depth_cm || 0).toFixed(1)}cm**\n`
          if (worst.explanation) reply += `\n💬 ${worst.explanation}`
        }
        break
      }

      default:
        reply = replyUnknown()
    }

    return res.status(200).json({
  success: true,
  data: {
    answer: reply,
    reply,
    intent,
    extraData: data,
  },
})
  } catch (err) {
    console.error('[Chatbot] Lỗi xử lý:', err)
    return next(err)
  }
})

module.exports = { chatbotRouter: router }