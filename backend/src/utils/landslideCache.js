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
 *
 * STRUCTURE:
 *   _map: Map<node_id: string, {
 *     prob_landslide: number|null,
 *     risk_level: string|null,
 *     rain_7d_accum: number|null,
 *     api_7d: number|null,
 *     soil_moisture_1d: number|null,
 *     prediction_time: string|null,
 *   }>
 */

const _map = new Map()
let _updatedAt = null

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Cập nhật cache từ mảng predictions (gọi sau mỗi bulkUpsert trong cron).
 * @param {Array<{node_id, prob_landslide, risk_level, rain_7d_accum, api_7d, soil_moisture_1d, prediction_time}>} predictions
 */
function updateCache(predictions) {
  for (const p of predictions) {
    _map.set(p.node_id, {
      prob_landslide:   p.prob_landslide   ?? null,
      risk_level:       p.risk_level       ?? null,
      rain_7d_accum:    p.rain_7d_accum    ?? null,
      api_7d:           p.api_7d           ?? null,
      soil_moisture_1d: p.soil_moisture_1d ?? null,
      prediction_time:  p.prediction_time  ?? null,
    })
  }
  _updatedAt = new Date()
}

/**
 * Lookup prediction mới nhất của 1 node.
 * @param {string} node_id
 * @returns {object|null}
 */
function getForNode(node_id) {
  return _map.get(node_id) ?? null
}

/**
 * Trả về thống kê trạng thái cache.
 */
function getStats() {
  return {
    size: _map.size,
    updatedAt: _updatedAt,
    ready: _map.size > 0,
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
 * Dùng query nhanh nhất có thể: lấy tất cả predictions trong ~30 phút cuối
 * (tương ứng với 1 lần chạy cron — tất cả nodes dùng cùng prediction_time).
 * Fallback: nếu không có data gần đây, lấy MAX(prediction_time) trước.
 *
 * @param {import('pg').Pool} pool — pg Pool instance
 * @returns {Promise<{loaded: number, elapsed: number}>}
 */
async function prewarmFromDb(pool) {
  const t0 = Date.now()
  try {
    // Bước 1 & 2: Lấy tất cả predictions có prediction_time trong 30 phút của lần chạy đó
    // Dùng trực tiếp subquery để tránh lỗi lệch múi giờ khi Node.js parse Date
    const { rows } = await pool.query(
      `WITH MaxTime AS (SELECT MAX(prediction_time) as latest FROM landslide_predictions)
       SELECT node_id, prob_landslide, risk_level, rain_7d_accum, api_7d, soil_moisture_1d, prediction_time
       FROM landslide_predictions, MaxTime
       WHERE prediction_time >= MaxTime.latest - INTERVAL '30 minutes'`
    )

    if (!rows.length || rows.length < 100000) {
      // Fallback: Nếu chỉ lấy được < 100,000 nodes (ví dụ do cron bị ngắt quãng),
      // tải toàn bộ bảng và deduplicate trong Node.js (nhanh hơn CockroachDB DISTINCT ON)
      console.warn(`[LandslideCache] Chỉ tìm thấy ${rows.length} nodes gần đây. Đang nạp toàn bộ lịch sử để deduplicate...`)
      const { rows: allRows } = await pool.query(
        `SELECT node_id, prob_landslide, risk_level, rain_7d_accum, api_7d, soil_moisture_1d, prediction_time
         FROM landslide_predictions`
      )
      
      let loaded = 0
      for (const p of allRows) {
        const existing = _map.get(p.node_id)
        if (!existing || new Date(p.prediction_time) > new Date(existing.prediction_time)) {
          _map.set(p.node_id, {
            prob_landslide:   p.prob_landslide   ?? null,
            risk_level:       p.risk_level       ?? null,
            rain_7d_accum:    p.rain_7d_accum    ?? null,
            api_7d:           p.api_7d           ?? null,
            soil_moisture_1d: p.soil_moisture_1d ?? null,
            prediction_time:  p.prediction_time  ?? null,
          })
          loaded++
        }
      }
      _updatedAt = new Date()
      const elapsed = Date.now() - t0
      console.log(`[LandslideCache] ✅ Pre-warm (JS Dedupe): ${_map.size.toLocaleString('vi-VN')} nodes | ${elapsed}ms`)
      return { loaded: _map.size, elapsed }
    }

    updateCache(rows)
    const elapsed = Date.now() - t0
    console.log(
      `[LandslideCache] ✅ Pre-warm: ${_map.size.toLocaleString('vi-VN')} nodes | ` +
      `${elapsed}ms`
    )
    return { loaded: _map.size, elapsed }
  } catch (err) {
    const elapsed = Date.now() - t0
    console.error(`[LandslideCache] ❌ Pre-warm thất bại (${elapsed}ms):`, err.message)
    return { loaded: 0, elapsed }
  }
}

/**
 * Scan toàn bộ cache để tìm top N nodes nguy hiểm nhất.
 * Chỉ quét risk_level 'DANGER' hoặc 'WARNING'.
 * @param {number} n
 * @returns {string[]} Danh sách node_id
 */
function scanTop(n) {
  const candidates = []
  for (const [node_id, pred] of _map.entries()) {
    if (pred.risk_level === 'DANGER' || pred.risk_level === 'WARNING') {
      candidates.push({ node_id, prob: pred.prob_landslide ?? 0 })
    }
  }
  candidates.sort((a, b) => b.prob - a.prob)
  return candidates.slice(0, n).map(c => c.node_id)
}

module.exports = { updateCache, getForNode, getStats, clearAll, prewarmFromDb, scanTop }
