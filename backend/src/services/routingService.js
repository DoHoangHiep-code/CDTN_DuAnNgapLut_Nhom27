'use strict'

/**
 * routingService.js – Safe Route Calculation for AQUA Bot
 * ─────────────────────────────────────────────────────────────────────────────
 * Evaluates whether a route (from external routing API) passes through
 * flooded grid nodes exceeding the user's vehicle threshold.
 *
 * ARCHITECTURE:
 *   1. Geocode start/end locations → lat/lng via grid_nodes
 *   2. Fetch polyline from external routing API (OSRM/Google Maps placeholder)
 *   3. Decode polyline → waypoints
 *   4. For each waypoint, find nearest grid_node + check flood_depth_cm
 *   5. Flag segments where flood_depth > maxDepthCm
 *   6. Return annotated route with safe/unsafe segments
 *
 * NOTE: This is a boilerplate. The external routing API integration
 * requires an API key (OSRM_URL or GOOGLE_MAPS_KEY) to be configured.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { Pool } = require('pg')
const { VEHICLE_THRESHOLDS } = require('./nlpService')

// ── Pool (reuses same connection pattern as other services) ──────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
})
pool.on('error', (err) => console.error('[RoutingService][Pool]', err.message))

const OSRM_URL = process.env.OSRM_URL || 'https://router.project-osrm.org'
const QUERY_TIMEOUT_MS = 8000

// ── Helpers ──────────────────────────────────────────────────────────────────

function withTimeout(promise, ms = QUERY_TIMEOUT_MS) {
  let t
  const guard = new Promise((_, reject) => {
    t = setTimeout(
      () => reject(Object.assign(new Error(`Timeout after ${ms}ms`), { code: 'TIMEOUT' })),
      ms
    )
  })
  return Promise.race([promise, guard]).finally(() => clearTimeout(t))
}

// ── 1. Geocode Location Name → Coordinates ──────────────────────────────────
/**
 * Look up a Hanoi location name in grid_nodes and return its coordinates.
 * Uses ILIKE for fuzzy matching and returns the centroid of matched nodes.
 *
 * @param {string} locationName – e.g. "Cầu Giấy", "Nguyễn Trãi"
 * @returns {Promise<{ lat: number, lng: number, location_name: string } | null>}
 */
async function geocodeLocation(locationName) {
  const sql = `
    SELECT
      AVG(latitude::float)  AS lat,
      AVG(longitude::float) AS lng,
      MIN(location_name)    AS location_name
    FROM grid_nodes
    WHERE location_name ILIKE $1
    HAVING COUNT(*) > 0
    LIMIT 1
  `
  try {
    const { rows } = await withTimeout(pool.query(sql, [`%${locationName}%`]))
    if (rows.length === 0) return null
    return {
      lat: Number(rows[0].lat),
      lng: Number(rows[0].lng),
      location_name: rows[0].location_name,
    }
  } catch (err) {
    console.error('[RoutingService] geocodeLocation error:', err.message)
    return null
  }
}

// ── 2. Fetch Route Polyline (External API Placeholder) ──────────────────────
/**
 * Fetch a driving route between two coordinates from an external routing API.
 *
 * Current implementation: OSRM (free, no API key required).
 * Can be swapped for Google Maps Directions API by changing the URL and parser.
 *
 * @param {{ lat: number, lng: number }} start
 * @param {{ lat: number, lng: number }} end
 * @returns {Promise<{ polyline: string, waypoints: Array<{lat: number, lng: number}>, distance_km: number, duration_min: number } | null>}
 */
async function fetchRoutePolyline(start, end) {
  // OSRM expects lng,lat order (not lat,lng)
  const url = `${OSRM_URL}/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=polyline`

  try {
    const axios = require('axios')
    const { data } = await withTimeout(axios.get(url, { timeout: 5000 }), 6000)

    if (data.code !== 'Ok' || !data.routes?.length) {
      console.warn('[RoutingService] OSRM returned no routes')
      return null
    }

    const route = data.routes[0]
    const waypoints = decodePolyline(route.geometry)

    return {
      polyline: route.geometry,
      waypoints,
      distance_km: Number((route.distance / 1000).toFixed(2)),
      duration_min: Number((route.duration / 60).toFixed(1)),
    }
  } catch (err) {
    console.error('[RoutingService] fetchRoutePolyline error:', err.message)
    return null
  }
}

// ── 3. Decode Google Polyline Format ─────────────────────────────────────────
/**
 * Decodes an encoded polyline string into an array of {lat, lng} points.
 * Uses the Google Polyline Algorithm.
 *
 * @param {string} encoded – encoded polyline string
 * @returns {Array<{lat: number, lng: number}>}
 */
function decodePolyline(encoded) {
  const points = []
  let index = 0, lat = 0, lng = 0

  while (index < encoded.length) {
    let shift = 0, result = 0, byte
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    lat += (result & 1) ? ~(result >> 1) : (result >> 1)

    shift = 0; result = 0
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    lng += (result & 1) ? ~(result >> 1) : (result >> 1)

    points.push({ lat: lat / 1e5, lng: lng / 1e5 })
  }
  return points
}

// ── 4. Load Flood Data for Route Bounding Box ───────────────────────────────
/**
 * Load current flood prediction data for all grid nodes within the
 * bounding box of the route waypoints.
 *
 * @param {Array<{lat: number, lng: number}>} waypoints
 * @returns {Promise<Array<{ node_id: string, lat: number, lng: number, flood_depth_cm: number, risk_level: string, location_name: string }>>}
 */
async function loadFloodDataForBBox(waypoints) {
  if (!waypoints.length) return []

  const lats = waypoints.map(w => w.lat)
  const lngs = waypoints.map(w => w.lng)
  const padding = 0.01 // ~1.1km padding

  const minLat = Math.min(...lats) - padding
  const maxLat = Math.max(...lats) + padding
  const minLng = Math.min(...lngs) - padding
  const maxLng = Math.max(...lngs) + padding

  const sql = `
    SELECT
      gn.node_id,
      gn.latitude::float  AS lat,
      gn.longitude::float AS lng,
      gn.location_name,
      fp.flood_depth_cm,
      fp.risk_level::text AS risk_level
    FROM grid_nodes gn
    JOIN (
      SELECT DISTINCT ON (node_id)
        node_id, flood_depth_cm, risk_level
      FROM flood_predictions
      WHERE time >= NOW() - INTERVAL '2 hours'
      ORDER BY node_id, time DESC
    ) fp ON gn.node_id = fp.node_id
    WHERE gn.latitude  BETWEEN $1 AND $2
      AND gn.longitude BETWEEN $3 AND $4
      AND fp.flood_depth_cm > 0
  `

  try {
    const { rows } = await withTimeout(pool.query(sql, [minLat, maxLat, minLng, maxLng]))
    return rows.map(r => ({
      node_id: r.node_id,
      lat: Number(r.lat),
      lng: Number(r.lng),
      flood_depth_cm: Number(r.flood_depth_cm),
      risk_level: r.risk_level,
      location_name: r.location_name,
    }))
  } catch (err) {
    console.error('[RoutingService] loadFloodDataForBBox error:', err.message)
    return []
  }
}

// ── 5. Evaluate Route Flood Risk ────────────────────────────────────────────
/**
 * For each waypoint on the route, find the nearest flooded grid node
 * and check if its flood depth exceeds the vehicle's safe threshold.
 *
 * Uses Haversine distance approximation for speed.
 * A waypoint is considered "at risk" if a flooded node is within 200m.
 *
 * @param {Array<{lat: number, lng: number}>} waypoints
 * @param {Array<{ node_id: string, lat: number, lng: number, flood_depth_cm: number, risk_level: string, location_name: string }>} floodData
 * @param {number} maxDepthCm – vehicle threshold
 * @returns {{ safe: boolean, floodedSegments: Array<{ waypoint: {lat, lng}, nearestNode: object, distance_m: number }>, safeSegments: number, totalSegments: number }}
 */
function evaluateRouteFloodRisk(waypoints, floodData, maxDepthCm) {
  const PROXIMITY_THRESHOLD_M = 200 // 200 meters
  const floodedSegments = []
  let safeCount = 0

  // Sample waypoints (every Nth point) to avoid O(W*F) with large routes
  const sampleRate = Math.max(1, Math.floor(waypoints.length / 100))
  const sampledWaypoints = waypoints.filter((_, i) => i % sampleRate === 0)

  for (const wp of sampledWaypoints) {
    let nearestNode = null
    let nearestDist = Infinity

    for (const node of floodData) {
      const dist = haversineMeters(wp.lat, wp.lng, node.lat, node.lng)
      if (dist < nearestDist) {
        nearestDist = dist
        nearestNode = node
      }
    }

    if (nearestNode && nearestDist <= PROXIMITY_THRESHOLD_M && nearestNode.flood_depth_cm > maxDepthCm) {
      floodedSegments.push({
        waypoint: wp,
        nearestNode,
        distance_m: Math.round(nearestDist),
      })
    } else {
      safeCount++
    }
  }

  return {
    safe: floodedSegments.length === 0,
    floodedSegments,
    safeSegments: safeCount,
    totalSegments: sampledWaypoints.length,
  }
}

/**
 * Fast Haversine distance in meters between two points.
 */
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000 // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT: getSafeRoute
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Calculate a route from startLocation to endLocation and evaluate
 * whether it's safe for the given vehicle type based on current flood data.
 *
 * @param {string} startLocation – e.g. "Hà Đông"
 * @param {string} endLocation   – e.g. "Hoàn Kiếm"
 * @param {string} vehicleType   – e.g. "xe máy" (defaults to "xe máy" if unknown)
 * @returns {Promise<{
 *   success: boolean,
 *   start: { lat, lng, location_name } | null,
 *   end: { lat, lng, location_name } | null,
 *   route: { distance_km, duration_min } | null,
 *   vehicle: { type, max_safe_depth_cm },
 *   evaluation: { safe, floodedSegments, safeSegments, totalSegments } | null,
 *   message: string
 * }>}
 */
async function getSafeRoute(startLocation, endLocation, vehicleType = 'xe máy') {
  const maxDepth = VEHICLE_THRESHOLDS[vehicleType] || VEHICLE_THRESHOLDS['xe máy']
  const vehicleInfo = { type: vehicleType, max_safe_depth_cm: maxDepth }

  // ── Step 1: Geocode both locations ──
  const [startCoords, endCoords] = await Promise.all([
    geocodeLocation(startLocation),
    geocodeLocation(endLocation),
  ])

  if (!startCoords) {
    return {
      success: false, start: null, end: endCoords, route: null,
      vehicle: vehicleInfo, evaluation: null,
      message: `❌ Không tìm thấy vị trí **${startLocation}** trong hệ thống. Vui lòng thử tên quận/đường khác.`,
    }
  }
  if (!endCoords) {
    return {
      success: false, start: startCoords, end: null, route: null,
      vehicle: vehicleInfo, evaluation: null,
      message: `❌ Không tìm thấy vị trí **${endLocation}** trong hệ thống. Vui lòng thử tên quận/đường khác.`,
    }
  }

  // ── Step 2: Fetch route from external API ──
  const routeData = await fetchRoutePolyline(startCoords, endCoords)
  if (!routeData) {
    return {
      success: false, start: startCoords, end: endCoords, route: null,
      vehicle: vehicleInfo, evaluation: null,
      message: `⚠️ Không thể lấy lộ trình từ **${startLocation}** đến **${endLocation}**. Dịch vụ định tuyến tạm thời không khả dụng.`,
    }
  }

  // ── Step 3: Load flood data for the route's bounding box ──
  const floodData = await loadFloodDataForBBox(routeData.waypoints)

  // ── Step 4: Evaluate flood risk along the route ──
  const evaluation = evaluateRouteFloodRisk(routeData.waypoints, floodData, maxDepth)

  // ── Step 5: Build response message ──
  let message
  if (evaluation.safe) {
    message = `✅ **Tuyến đường an toàn!**\n\n`
      + `📍 Từ **${startCoords.location_name}** → **${endCoords.location_name}**\n`
      + `📏 Khoảng cách: **${routeData.distance_km} km** | ⏱ Thời gian: **${routeData.duration_min} phút**\n`
      + `🚗 Phương tiện: **${vehicleType}** (ngưỡng an toàn: ${maxDepth}cm)\n\n`
      + `Không phát hiện điểm ngập vượt ngưỡng trên tuyến đường này. Bạn có thể di chuyển bình thường.\n\n`
      + `⚠️ _Lưu ý: Tình trạng ngập có thể thay đổi nhanh khi mưa lớn. Theo dõi cập nhật._`
  } else {
    const dangerList = evaluation.floodedSegments
      .slice(0, 5) // Show max 5 danger points
      .map((seg, i) =>
        `  ${i + 1}. 📍 **${seg.nearestNode.location_name || 'Điểm đo'}** `
        + `– ngập **${seg.nearestNode.flood_depth_cm.toFixed(1)}cm** `
        + `(${seg.nearestNode.risk_level === 'severe' ? '🔴 Nghiêm trọng' : '🟠 Nguy cơ cao'}) `
        + `– cách tuyến ${seg.distance_m}m`
      ).join('\n')

    message = `⚠️ **Cảnh báo: Tuyến đường có ${evaluation.floodedSegments.length} điểm ngập nguy hiểm!**\n\n`
      + `📍 Từ **${startCoords.location_name}** → **${endCoords.location_name}**\n`
      + `📏 Khoảng cách: **${routeData.distance_km} km** | ⏱ Thời gian: **${routeData.duration_min} phút**\n`
      + `🚗 Phương tiện: **${vehicleType}** (ngưỡng an toàn: ${maxDepth}cm)\n\n`
      + `### 🚨 Các điểm ngập trên tuyến:\n\n${dangerList}\n\n`
      + `📋 **Khuyến nghị:**\n`
      + `  • Tìm tuyến thay thế tránh các khu vực trên\n`
      + `  • Nếu bắt buộc phải đi, di chuyển thật chậm và tránh vùng nước sâu\n`
      + `  • Với **${vehicleType}**, ngập trên **${maxDepth}cm** có thể gây chết máy/mất kiểm soát`
  }

  return {
    success: true,
    start: startCoords,
    end: endCoords,
    route: { distance_km: routeData.distance_km, duration_min: routeData.duration_min },
    vehicle: vehicleInfo,
    evaluation,
    message,
  }
}

// ═════════════════════════════════════════════════════════════════════════════

module.exports = {
  getSafeRoute,
  geocodeLocation,
  fetchRoutePolyline,
  decodePolyline,
  evaluateRouteFloodRisk,
  loadFloodDataForBBox,
  VEHICLE_THRESHOLDS,
}
