'use strict'

/**
 * landslideCache.js
 * ─────────────────────────────────────────────────────────────────────────────
 * In-memory cache cho kết quả dự báo sạt lở mới nhất.
 *
 * TẠI SAO CẦN CACHE?
 *   - Bảng landslide_predictions có 425.190 rows
 *   - Mỗi query /nodes cần CTE ROW_NUMBER() OVER(PARTITION BY node_id) → full scan
 *   - Với CockroachDB serverless, full scan 425K rows mất 30-60s → timeout
 *   - Cache cho phép lookup O(1) theo node_id → query /nodes còn <300ms
 *
 * VÒNG ĐỜI CACHE:
 *   Startup → prewarmFromDb() → load tất cả latest predictions vào Map
 *   Cron chạy → updateCache(batchResults) → cập nhật từng node mới nhất
 */
// STRUCTURE:
//   _map: Map<node_id: string, Array<{
//     prob_landslide: number|null,
//     risk_level: string|null,
//     rain_7d_accum: number|null,
//     api_7d: number|null,
//     soil_moisture_1d: number|null,
//     prediction_time: string|null,
//     province: string|null,
//   }>> // Array chứa 4 phần tử tương ứng với 4 ngày (T0, T1, T2, T3)

const _map = new Map()
let _updatedAt = null
let _isReady = false

// Chatbot-specific cache fields
let worstAreas = []
let currentStatus = []
let lastUpdated = null


function invalidateCache() {
  try {
    const { invalidateCacheNamespace } = require('../middlewares/apiCache');
    invalidateCacheNamespace('landslide_api');
  } catch (e) {
    console.warn('[LandslideCache] Could not invalidate cache', e.message);
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Cập nhật cache từ mảng predictions (gọi sau mỗi bulkUpsert trong cron).
 * @param {Array<{node_id, prob_landslide, risk_level, rain_7d_accum, api_7d, soil_moisture_1d, prediction_time, offset}>} predictions
 */
function updateCache(predictions) {
  for (const p of predictions) {
    const arr = _map.get(p.node_id) || []
    
    // Đảm bảo mảng có 4 phần tử
    while(arr.length < 4) arr.push(null)
    
    // Nếu có offset truyền vào thì dùng, không thì tự suy luận từ mảng
    // Trong trường hợp cron truyền mảng đã filter offset=0, nó sẽ đè lên index 0
    const offset = p.offset !== undefined ? p.offset : 0;
    
    const existing = arr[offset] || {};
    arr[offset] = {
      prob_landslide:   p.prob_landslide   ?? existing.prob_landslide ?? null,
      risk_level:       p.risk_level       ?? existing.risk_level ?? null,
      rain_7d_accum:    p.rain_7d_accum    ?? existing.rain_7d_accum ?? null,
      api_7d:           p.api_7d           ?? existing.api_7d ?? null,
      soil_moisture_1d: p.soil_moisture_1d ?? existing.soil_moisture_1d ?? null,
      prediction_time:  p.prediction_time  ?? existing.prediction_time ?? null,
      province:         p.province         ?? existing.province ?? null,
      lat:              existing.lat ?? null,
      lon:              existing.lon ?? null,
      location_name:    existing.location_name ?? null,
      slope:            existing.slope ?? null,
      elevation:        existing.elevation ?? null,
    }
    _map.set(p.node_id, arr)
  }
  _updatedAt = new Date()
}

/**
 * Lookup prediction mới nhất của 1 node theo offset (0: hôm nay, 1: mai, 2: ngày kia, 3: ngày kìa).
 * @param {string} node_id
 * @param {number} offset
 * @returns {object|null}
 */
function getForNode(node_id, offset = 0) {
  const arr = _map.get(node_id)
  return arr ? (arr[offset] || arr[0] || null) : null
}

/**
 * Lấy các điểm nằm trong bounding box từ In-Memory Cache (siêu tốc)
 */
function getNodesInBbox(minLat, maxLat, minLng, maxLng, offset = 0, riskFilter = 'ALL', limit = 3000) {
  const nodes = [];
  for (const [node_id, arr] of _map.entries()) {
    const pred = arr[offset] || arr[0];
    if (!pred) continue;
    
    if (pred.lat >= minLat && pred.lat <= maxLat && pred.lon >= minLng && pred.lon <= maxLng) {
      if (riskFilter === 'DANGER' && pred.risk_level !== 'DANGER') continue;
      if (riskFilter === 'WARNING' && !['WARNING', 'DANGER'].includes(pred.risk_level)) continue;
      
      nodes.push({
        node_id,
        lat: pred.lat,
        lon: pred.lon,
        province: pred.province,
        location_name: pred.location_name,
        slope: pred.slope,
        elevation: pred.elevation,
        prob_landslide: pred.prob_landslide,
        risk_level: pred.risk_level,
        rain_7d_accum: pred.rain_7d_accum,
        api_7d: pred.api_7d,
        soil_moisture_1d: pred.soil_moisture_1d,
        prediction_time: pred.prediction_time
      });
    }
  }
  nodes.sort((a, b) => (b.prob_landslide || 0) - (a.prob_landslide || 0));
  return nodes.slice(0, limit);
}

/**
 * Lấy danh sách cảnh báo động (thanh tin tức chạy) cho Landslide
 */
function getDynamicAlerts() {
  const alerts = [];
  for (const arr of _map.values()) {
    const p = arr[0]; // Chỉ lấy mốc T0 (hôm nay)
    if (!p) continue;
    if (p.risk_level === 'DANGER' || p.risk_level === 'WARNING') {
      alerts.push({
        district: p.location_name || p.province,
        prob_landslide: p.prob_landslide,
        risk_level: p.risk_level,
        soil_moisture: p.soil_moisture_1d,
        rain: p.rain_7d_accum,
      });
    }
  }
  // Sort by probability DESC
  alerts.sort((a, b) => b.prob_landslide - a.prob_landslide);
  // Get top 10 unique locations
  const unique = [];
  const seen = new Set();
  for (const a of alerts) {
    const loc = (a.district || '').split(',').slice(-1)[0].trim() || a.district;
    if (!seen.has(loc)) {
      seen.add(loc);
      a.district = loc;
      unique.push(a);
      if (unique.length >= 10) break;
    }
  }
  return unique;
}

/**
 * Trả về thống kê trạng thái cache.
 */
function getStats() {
  return {
    size: _map.size,
    updatedAt: _updatedAt,
    ready: _isReady,
  }
}

/**
 * Xóa toàn bộ cache.
 */
function clearAll() {
  _map.clear()
  _updatedAt = null
}

/**
 * Pre-warm cache từ DB khi server khởi động.
 * Nạp 4 mốc thời gian mới nhất (Hôm nay + 3 ngày tới) cho mỗi điểm.
 *
 * @param {import('pg').Pool} pool — pg Pool instance
 * @returns {Promise<{loaded: number, elapsed: number}>}
 */
async function prewarmFromDb(pool) {
  const t0 = Date.now()
  try {
    // Bước 1: Query 4 prediction_time mới nhất (tương ứng với T3, T2, T1, T0 của lần chạy cron gần nhất)
    const { rows } = await pool.query(
      `WITH LatestTimes AS (
         SELECT DISTINCT prediction_time 
         FROM landslide_predictions 
         WHERE risk_level IS NOT NULL 
         ORDER BY prediction_time DESC 
         LIMIT 4
       )
       SELECT p.node_id, p.prob_landslide, p.risk_level, p.rain_7d_accum, p.api_7d, p.soil_moisture_1d, p.prediction_time, n.province, n.lat, n.lon, n.location_name, n.slope, n.elevation
       FROM landslide_predictions p
       JOIN landslide_grid_nodes n ON p.node_id = n.node_id
       JOIN LatestTimes lt ON p.prediction_time = lt.prediction_time
       ORDER BY p.prediction_time ASC`
    )

    if (!rows.length || rows.length < 100000) {
      console.warn(`[LandslideCache] Dữ liệu trong DB quá ít (${rows.length} rows), có thể server mới khởi tạo.`)
    }

    // Bước 2: Nhóm vào array 4 mốc thời gian
    // Vì ORDER BY p.prediction_time ASC, ngày cũ nhất (T0) sẽ đến trước, T3 sẽ đến sau
    for (const p of rows) {
      const arr = _map.get(p.node_id) || [null, null, null, null]
      
      let offset = arr.findIndex(x => x === null)
      if (offset === -1) offset = 3 // Safety fallback
      
      arr[offset] = {
        prob_landslide:   p.prob_landslide   ?? null,
        risk_level:       p.risk_level       ?? null,
        rain_7d_accum:    p.rain_7d_accum    ?? null,
        api_7d:           p.api_7d           ?? null,
        soil_moisture_1d: p.soil_moisture_1d ?? null,
        prediction_time:  p.prediction_time  ?? null,
        province:         p.province         ?? null,
        lat:              p.lat !== undefined ? parseFloat(p.lat) : null,
        lon:              p.lon !== undefined ? parseFloat(p.lon) : null,
        location_name:    p.location_name    ?? null,
        slope:            p.slope !== undefined ? parseFloat(p.slope) : null,
        elevation:        p.elevation !== undefined ? parseFloat(p.elevation) : null,
      }
      _map.set(p.node_id, arr)
    }

    _updatedAt = new Date()
    const elapsed = Date.now() - t0
    console.log(`[LandslideCache] ✅ Pre-warm: ${_map.size.toLocaleString('vi-VN')} nodes | ${elapsed}ms`)
    _isReady = true
    
    // Khởi động nạp chatbot cache song song
    lastUpdated = new Date()
    populateChatbotCache(pool).catch(err => console.error('[LandslideCache] populateChatbotCache error:', err.message))

    invalidateCache()
    return { loaded: _map.size, elapsed }
  } catch (err) {
    const elapsed = Date.now() - t0
    console.error(`[LandslideCache] ❌ Pre-warm thất bại (${elapsed}ms):`, err.message)
    return { loaded: 0, elapsed }
  }
}

/**
 * Scan toàn bộ cache để tìm top N nodes nguy hiểm nhất.
 * Chỉ quét risk_level 'DANGER' hoặc 'WARNING' của offset tương ứng.
 * @param {number} n
 * @param {number} offset
 * @returns {string[]} Danh sách node_id
 */
function scanTop(n, offset = 0) {
  const candidates = []
  for (const [node_id, arr] of _map.entries()) {
    const pred = arr[offset]
    if (pred && pred.prob_landslide != null) {
      candidates.push({ node_id, prob: pred.prob_landslide })
    }
  }
  candidates.sort((a, b) => b.prob - a.prob)
  return candidates.slice(0, n).map(c => c.node_id)
}

/**
 * Tính toán thống kê cho Dashboard (Dùng offset cho T0, T1, T2, T3)
 * @param {number} offset
 * @returns {object} dashboard stats
 */
function getDashboardStats(offset = 0) {
  let avgRain7d = 0, avgSoilMoisture = 0, dangerCount = 0, warningCount = 0, safeCount = 0;
  let countRain = 0, countSoil = 0;
  const provinceStats = new Map();

  for (const arr of _map.values()) {
    const pred = arr[offset]
    if (!pred) continue;

    if (pred.risk_level === 'DANGER') dangerCount++;
    else if (pred.risk_level === 'WARNING') warningCount++;
    else if (pred.risk_level === 'SAFE') safeCount++;

    if (pred.rain_7d_accum != null) {
      avgRain7d += pred.rain_7d_accum;
      countRain++;
    }
    if (pred.soil_moisture_1d != null) {
      avgSoilMoisture += pred.soil_moisture_1d;
      countSoil++;
    }

    if (pred.risk_level === 'DANGER' || pred.risk_level === 'WARNING') {
      if (pred.province) {
         if (!provinceStats.has(pred.province)) provinceStats.set(pred.province, { name: pred.province, danger: 0, warning: 0 });
         const pStat = provinceStats.get(pred.province);
         if (pred.risk_level === 'DANGER') pStat.danger++;
         if (pred.risk_level === 'WARNING') pStat.warning++;
      }
    }
  }

  const topProvinces = Array.from(provinceStats.values())
    .sort((a, b) => (b.danger * 10 + b.warning) - (a.danger * 10 + a.warning))
    .slice(0, 5);

  return {
    rain_7d_accum_avg: countRain > 0 ? +(avgRain7d / countRain).toFixed(1) : 0,
    soil_moisture_avg: countSoil > 0 ? +(avgSoilMoisture * 100 / countSoil).toFixed(1) : 0,
    danger_count: dangerCount,
    warning_count: warningCount,
    safe_count: safeCount,
    top_provinces: topProvinces,
  }
}

/**
 * Cập nhật chatbot cache (worstAreas, currentStatus) dựa trên dữ liệu sạt lở mới nhất.
 */
async function populateChatbotCache(pool) {
  try {
    // 1. Query top 10 current status danger/warning nodes
    const sqlCurrent = `
      SELECT sub.node_id, sub.prob_landslide, sub.risk_level, sub.prediction_time,
             gn.location_name, gn.province, gn.lat, gn.lon, gn.slope, gn.elevation,
             sub.rain_1d_accum, sub.rain_7d_accum, sub.api_7d, sub.api_14d, sub.soil_moisture_1d, sub.soil_moisture_7d
      FROM (
        SELECT DISTINCT ON (node_id) *
        FROM landslide_predictions
        WHERE prediction_time >= NOW() - INTERVAL '24 hours'
          AND risk_level IN ('DANGER', 'WARNING')
        ORDER BY node_id, prediction_time DESC
      ) sub
      JOIN landslide_grid_nodes gn ON gn.node_id = sub.node_id
      ORDER BY sub.prob_landslide DESC
      LIMIT 10
    `
    const resCurrent = await pool.query(sqlCurrent)
    module.exports.currentStatus = resCurrent.rows

    // 2. Query top 5 worst areas
    const sqlWorst = `
      SELECT sub.node_id, sub.prob_landslide, sub.risk_level, sub.prediction_time,
             gn.location_name, gn.province, gn.lat, gn.lon, gn.slope, gn.elevation,
             sub.rain_1d_accum, sub.rain_7d_accum, sub.api_7d, sub.api_14d, sub.soil_moisture_1d, sub.soil_moisture_7d
      FROM (
        SELECT DISTINCT ON (node_id) *
        FROM landslide_predictions
        WHERE prediction_time >= NOW() - INTERVAL '24 hours'
        ORDER BY node_id, prob_landslide DESC, prediction_time DESC
      ) sub
      JOIN landslide_grid_nodes gn ON gn.node_id = sub.node_id
      ORDER BY sub.prob_landslide DESC
      LIMIT 5
    `
    const resWorst = await pool.query(sqlWorst)
    module.exports.worstAreas = resWorst.rows

    module.exports.lastUpdated = new Date()
    console.log(`[LandslideCache] Chatbot cache populated: currentStatus=${module.exports.currentStatus.length}, worstAreas=${module.exports.worstAreas.length}`)
  } catch (err) {
    console.error('[LandslideCache] Failed to populate chatbot cache:', err.message)
  }
}

module.exports = { 
  updateCache, 
  getForNode,
  getNodesInBbox,
  getDynamicAlerts,
  getStats, 
  clearAll, 
  prewarmFromDb, 
  scanTop, 
  getDashboardStats,
  worstAreas,
  currentStatus,
  lastUpdated,
  populateChatbotCache
}
