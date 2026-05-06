'use strict'

/**
 * idwInferenceService.js – Nội suy thời tiết IDW cho một tọa độ bất kỳ
 * ─────────────────────────────────────────────────────────────────────────────
 * Thuật toán:
 *   1. Với node có is_out_of_bounds = false:
 *      virtual_rain   = Σ( w_i × rain_i )  với i ∈ {st1, st2, st3}
 *      virtual_clouds = Σ( w_i × clouds_i )
 *
 *   2. Với node có is_out_of_bounds = true:
 *      Fallback: gọi OWM Live API trực tiếp cho tọa độ node đó.
 *
 *   3. Sliding Window (SQL):
 *      prcp_3h  = SUM mưa của 1 bản ghi gần nhất của node (3h/record)
 *      prcp_6h  = SUM mưa của 2 bản ghi gần nhất
 *      prcp_12h = SUM mưa của 4 bản ghi gần nhất
 */

const { sequelize }           = require('../db/sequelize')
const { getWeatherByCoords }  = require('./OpenWeatherService')

// ─── Lấy thời tiết mới nhất của danh sách station IDs từ weather_measurements ─
async function getLatestStationWeather(stationIds) {
  if (!stationIds || !stationIds.length) return new Map()

  // Lấy bản ghi mới nhất của mỗi station (dựa trên node_id = station_id trong bảng weather_measurements)
  // Trạm ảo được lưu theo node_id = station_id (đặc thù của Phase 3 WeatherCron)
  const [rows] = await sequelize.query(`
    SELECT DISTINCT ON (node_id) node_id, rain_1h, clouds, temp, rhum
    FROM weather_measurements
    WHERE node_id = ANY(:ids)
    ORDER BY node_id, time DESC
  `, {
    replacements: { ids: stationIds },
  })

  const map = new Map()
  for (const r of rows) {
    map.set(Number(r.node_id), {
      rain_1h: parseFloat(r.rain_1h ?? r.prcp ?? 0),
      clouds:  parseInt(r.clouds ?? 0),
      temp:    parseFloat(r.temp ?? 0),
      rhum:    parseFloat(r.rhum ?? 0),
    })
  }
  return map
}

// ─── Tính Sliding Window Rain bằng SQL ───────────────────────────────────────
async function getSlidingWindowRain(nodeId) {
  const [rows] = await sequelize.query(`
    SELECT prcp
    FROM weather_measurements
    WHERE node_id = :nodeId
    ORDER BY time DESC
    LIMIT 12
  `, {
    replacements: { nodeId: Number(nodeId) },
  })

  const vals = rows.map(r => parseFloat(r.prcp ?? 0))
  const prcp_3h  = vals.slice(0, 1).reduce((s, v) => s + v, 0)
  const prcp_6h  = vals.slice(0, 2).reduce((s, v) => s + v, 0)
  const prcp_12h = vals.slice(0, 4).reduce((s, v) => s + v, 0)

  return { prcp_3h, prcp_6h, prcp_12h }
}

// ─── IDW Inference chính ─────────────────────────────────────────────────────
/**
 * Tính toán thời tiết nội suy IDW cho một grid_node.
 *
 * @param {object} node – GridNode plain object (có st1_id, st1_weight, ..., is_out_of_bounds)
 * @returns {Promise<{rain_1h, clouds, temp, rhum, prcp_3h, prcp_6h, prcp_12h, source}>}
 */
async function inferWeatherForNode(node) {
  const {
    node_id,
    latitude, longitude,
    is_out_of_bounds,
    st1_id, st1_weight,
    st2_id, st2_weight,
    st3_id, st3_weight,
    elevation, slope,
  } = node

  const lat = parseFloat(latitude)
  const lon = parseFloat(longitude)

  // ── Sliding Window (luôn tính từ DB lịch sử) ──────────────────────────────
  const { prcp_3h, prcp_6h, prcp_12h } = await getSlidingWindowRain(node_id)

  // ── Out-of-bounds: fallback OWM Live ──────────────────────────────────────
  if (is_out_of_bounds) {
    const live = await getWeatherByCoords(lat, lon)
    if (live) {
      return {
        rain_1h: live.rain1h,
        clouds:  live.clouds,
        temp:    live.temp,
        rhum:    live.humidity,
        prcp_3h, prcp_6h, prcp_12h,
        elevation_m: parseFloat(elevation) || 5,
        slope:       parseFloat(slope)     || 1,
        source: 'owm-live-fallback',
      }
    }
    // OWM cũng thất bại → dùng giá trị 0 để không crash
    return {
      rain_1h: 0, clouds: 0, temp: 30, rhum: 70,
      prcp_3h, prcp_6h, prcp_12h,
      elevation_m: parseFloat(elevation) || 5,
      slope:       parseFloat(slope)     || 1,
      source: 'fallback-zero',
    }
  }

  // ── IDW Interpolation ──────────────────────────────────────────────────────
  const stIds = [
    { id: st1_id, w: st1_weight },
    { id: st2_id, w: st2_weight },
    { id: st3_id, w: st3_weight },
  ].filter(s => s.id != null && s.w != null)

  const stationMap = await getLatestStationWeather(stIds.map(s => Number(s.id)))

  let rain_1h = 0, clouds = 0, temp = 0, rhum = 0, totalW = 0
  for (const { id, w } of stIds) {
    const d = stationMap.get(Number(id))
    if (!d) continue
    rain_1h += w * d.rain_1h
    clouds  += w * d.clouds
    temp    += w * d.temp
    rhum    += w * d.rhum
    totalW  += w
  }

  // Nếu không tìm được station nào → fallback OWM Live
  if (totalW === 0) {
    const live = await getWeatherByCoords(lat, lon)
    if (live) {
      return {
        rain_1h: live.rain1h, clouds: live.clouds,
        temp: live.temp,      rhum: live.humidity,
        prcp_3h, prcp_6h, prcp_12h,
        elevation_m: parseFloat(elevation) || 5,
        slope:       parseFloat(slope)     || 1,
        source: 'owm-live-no-station-data',
      }
    }
    return {
      rain_1h: 0, clouds: 0, temp: 30, rhum: 70,
      prcp_3h, prcp_6h, prcp_12h,
      elevation_m: parseFloat(elevation) || 5,
      slope:       parseFloat(slope)     || 1,
      source: 'fallback-zero',
    }
  }

  // Chuẩn hóa theo tổng trọng số thực tế (phòng khi 1/3 station thiếu data)
  rain_1h /= totalW
  clouds  /= totalW
  temp    /= totalW
  rhum    /= totalW

  // Safeguard nhiễu: rain < 0.5mm → ép về 0
  if (rain_1h < 0.5) rain_1h = 0

  return {
    rain_1h: parseFloat(rain_1h.toFixed(3)),
    clouds:  Math.round(clouds),
    temp:    parseFloat(temp.toFixed(2)),
    rhum:    parseFloat(rhum.toFixed(1)),
    prcp_3h, prcp_6h, prcp_12h,
    elevation_m: parseFloat(elevation) || 5,
    slope:       parseFloat(slope)     || 1,
    source: 'idw',
  }
}

module.exports = { inferWeatherForNode, getSlidingWindowRain }
