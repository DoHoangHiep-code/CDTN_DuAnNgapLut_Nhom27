'use strict'

/**
 * idwInferenceService.js – Lấy thời tiết từ Trạm gần nhất (Exact Nearest Neighbor)
 * ─────────────────────────────────────────────────────────────────────────────
 * Thuật toán MỚI:
 * 1. BỎ IDW. BỎ gọi OWM Live API trực tiếp để bảo vệ Rate Limit.
 * 2. Tìm trạm đo thời tiết có dữ liệu gần tọa độ lat/lon nhất.
 * 3. Lấy chính xác 100% thời tiết gốc của trạm đó trả về (nhiệt độ, độ ẩm thật).
 * 4. Tính Sliding Window Rain dựa trên ID của chính Trạm đó.
 */

const { sequelize } = require('../../../db/sequelize')

async function getNearestStationWeather(lat, lon, targetTime) {
  const tTime = targetTime || new Date()

  const [rows] = await sequelize.query(`
    WITH nearest AS (
      SELECT gn.node_id,
             (gn.latitude::float - :lat)^2 + (gn.longitude::float - :lon)^2 AS dist2
      FROM grid_nodes gn
      WHERE gn.latitude BETWEEN :lat - 0.1 AND :lat + 0.1
        AND gn.longitude BETWEEN :lon - 0.1 AND :lon + 0.1
        AND EXISTS (
        SELECT 1 FROM weather_measurements WHERE node_id = gn.node_id LIMIT 1
      )
      ORDER BY dist2 ASC
      LIMIT 1
    )
    SELECT wm.node_id, wm.prcp, wm.clouds, wm.temp, wm.rhum, wm.time
    FROM weather_measurements wm
    JOIN nearest n ON n.node_id = wm.node_id
    WHERE wm.time <= :tTime::timestamp + interval '2 hours'
      AND wm.time >= :tTime::timestamp - interval '2 hours'
    ORDER BY ABS(EXTRACT(EPOCH FROM (wm.time - :tTime::timestamp))) ASC
    LIMIT 1
  `, { replacements: { lat: parseFloat(lat), lon: parseFloat(lon), tTime } })

  if (!rows || rows.length === 0) return null

  const r = rows[0]
  return {
    station_id: r.node_id, // Giữ lại ID của trạm để tính mưa tích lũy
    rain_1h: parseFloat(r.prcp ?? 0),
    prcp:    parseFloat(r.prcp ?? 0),
    clouds:  Math.round(r.clouds ?? 0),
    temp:    parseFloat(r.temp ?? 0),
    rhum:    parseFloat(r.rhum ?? 0),
  }
}

async function getSlidingWindowRain(stationId) {
  const [rows] = await sequelize.query(`
    SELECT prcp
    FROM weather_measurements
    WHERE node_id = :stationId
    ORDER BY time DESC
    LIMIT 12
  `, { replacements: { stationId: String(stationId) } })

  const vals = rows.map(r => parseFloat(r.prcp ?? 0))
  // Nếu có đủ data, tính tổng. Nếu mảng trống sẽ tự trả về 0.
  const prcp_3h  = vals.slice(0, 1).reduce((s, v) => s + v, 0)
  const prcp_6h  = vals.slice(0, 2).reduce((s, v) => s + v, 0)
  const prcp_12h = vals.slice(0, 4).reduce((s, v) => s + v, 0)

  return { prcp_3h, prcp_6h, prcp_12h }
}

async function inferWeatherForNode(node, targetTime) {
  const { latitude, longitude, elevation, slope } = node
  const lat = parseFloat(latitude)
  const lon = parseFloat(longitude)

  // 1. TÌM TRẠM GẦN NHẤT TRƯỚC (Bắt buộc phải tìm trạm để lấy Station ID)
  const nearest = await getNearestStationWeather(lat, lon, targetTime).catch(() => null)
  
  // 2. NẾU KHÔNG TÌM THẤY TRẠM -> TRẢ VỀ ZERO KHÔNG GỌI API OWM
  if (!nearest) {
    return {
      rain_1h: 0, clouds: 0, temp: 30, rhum: 70,
      prcp_3h: 0, prcp_6h: 0, prcp_12h: 0,
      elevation_m: parseFloat(elevation) || 5,
      slope:       parseFloat(slope)     || 1,
      source: 'fallback-zero',
    }
  }

  // 3. TÍNH MƯA TÍCH LŨY TỪ TRẠM VỪA TÌM ĐƯỢC
  const { prcp_3h, prcp_6h, prcp_12h } = await getSlidingWindowRain(nearest.station_id)

  // 4. TRẢ VỀ SỐ LIỆU CHÍNH XÁC 100% CỦA TRẠM
  return {
    rain_1h: nearest.rain_1h, 
    clouds:  nearest.clouds,
    temp:    nearest.temp, 
    rhum:    nearest.rhum,
    prcp_3h, prcp_6h, prcp_12h,
    elevation_m: parseFloat(elevation) || 5,
    slope:       parseFloat(slope)     || 1,
    source: 'proximity-nearest-exact',
  }
}

module.exports = { inferWeatherForNode, getSlidingWindowRain }
