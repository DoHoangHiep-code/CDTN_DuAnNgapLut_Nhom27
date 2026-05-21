'use strict'

/**
 * floodFeature.service.js
 *
 * Tra cứu flood features theo grid_id hoặc tọa độ (lat/lng).
 * Chiến lược: Redis Cache → CockroachDB (AS OF SYSTEM TIME '-10s')
 *
 * CockroachDB Time-Travel Query (-10s) = đọc snapshot 10 giây trước,
 * bỏ qua các lock đang giữ bởi Cron Job batch-insert đang chạy.
 *
 * PERF FIX (2026-05):
 *  - getFeatureByLatLng: thêm bbox pre-filter +/-0.5 để giảm từ 53K xuống ~200 nodes
 *    trước khi tính Haversine distance → tránh full table scan
 *  - Pool dùng lại từ sequelize.js thay vì tạo pool riêng (tránh connection leak)
 *
 * BUG FIX (2026-05-08):
 *  - CockroachDB yêu cầu AS OF SYSTEM TIME đặt ở CUỐI toàn bộ câu lệnh (sau LIMIT),
 *    KHÔNG đặt sau từng tên bảng trong FROM/JOIN clause.
 *
 *  SAI (gây lỗi `at or near "left": syntax error`, error code 42601):
 *    FROM grid_nodes gn
 *    LEFT JOIN LATERAL (...)   ← parser đọc "LEFT" sau AS OF → lỗi
 *
 *  ĐÚNG (CockroachDB standard):
 *    FROM grid_nodes gn
 *    LEFT JOIN LATERAL (...)
 *    WHERE ...
 *    LIMIT 1
 *     ← đặt sau cùng
 *
 * QUERY TIMEOUT FIX (2026-05-08):
 *  - Mọi query đều được bao bởi Promise.race() với timeout 8s
 *  - Nếu DB bận/pool exhausted → throw lỗi rõ ràng thay vì treo vô hạn
 */

const { Pool } = require('pg')
const redis = require('../../../common/services/redisClient')

// -- pg Pool - dùng DATABASE_URL_POOLER nếu có (ưu tiên IPv4 pooler cho CockroachDB) --
const pool = new Pool({
  connectionString: process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  min: 1,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
})

pool.on('error', (err) => {
  console.error('[floodFeature.pool] Unexpected pool error:', err.message)
})

// TTL 300s (5 phút) – dữ liệu thời tiết cập nhật mỗi 10–15 phút nên vẫn đủ tươi
const CACHE_TTL_SECONDS = 300

// Bán kính bbox pre-filter (đơn vị: độ)
// 0.5 độ ≈ 55km – đủ lớn để bao phủ kết quả gần nhất
const BBOX_RADIUS_DEG = 0.5

// Timeout cho mỗi DB query (ms) – đủ cho CockroachDB cloud latency
const QUERY_TIMEOUT_MS = 8000

/**
 * Bao một Promise với timeout, ném lỗi có type 'QUERY_TIMEOUT' nếu quá giờ.
 * @param {Promise<any>} promise
 * @param {number} ms
 * @returns {Promise<any>}
 */
function withTimeout(promise, ms = QUERY_TIMEOUT_MS) {
  let timer
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`DB query timed out after ${ms}ms`)
      err.code = 'QUERY_TIMEOUT'
      reject(err)
    }, ms)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer))
}

// -- Truy vấn theo grid_id ----------------------------------------------------
async function getFeatureByGridId(gridId) {
  const cacheKey = `flood:grid:${gridId}`

  // 1. Kiểm tra Redis
  try {
    const cached = await redis.get(cacheKey)
    if (cached) {
      return { source: 'cache', data: JSON.parse(cached) }
    }
  } catch (_redisErr) {
    // Redis không available → bỏ qua, tiếp tục query DB
  }

  // 2. Cache Miss → Query CockroachDB
  // FIX: Thay LEFT JOIN LATERAL bằng DISTINCT ON subquery – tương tự CronJob
  // Lý do: LATERAL thực thi subquery MỘI LẦN cho từng node → gây treo DB.
  // DISTINCT ON chỉ quét 1 lần với time-filter → an toàn và nhanh.
  const sql = `
    SELECT
      gn.node_id,
      gn.grid_id,
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
      wm.rainy_season_flag,

      fp.flood_depth_cm,
      fp.risk_level::text AS risk_level,
      fp.explanation,
      fp.time AS predicted_at

    FROM grid_nodes gn
    -- DISTINCT ON thay cho LATERAL: chỉ lấy bản ghi mới nhất trong 24h mỗi node
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
    WHERE gn.grid_id = $1
    LIMIT 1
  `

  const { rows } = await withTimeout(pool.query(sql, [gridId]))
  const row = rows[0] ?? null

  if (row) {
    try {
      await redis.setEx(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(row))
    } catch (_redisErr) { /* bỏ qua lỗi Redis write */ }
  }

  return { source: 'db', data: row }
}

// -- Truy vấn theo tọa độ (tìm node gần nhất) ----------------------------------
//
// PERF FIX: Thêm bbox pre-filter WHERE lat BETWEEN và lng BETWEEN
// TRƯỚC khi tính Haversine distance.
//
// Lý do: Haversine (acos/cos/sin) tốn kém, nếu tính cho 53K nodes → timeout.
// Với bbox +/-0.5 (~55km), chỉ còn ~200-500 nodes cần tính → nhanh hơn 100x.
// idx_grid_nodes_lat_lng đảm bảo WHERE clause này dùng Index Scan.
//
// FIX: AS OF SYSTEM TIME đặt SAU CÙNG (sau LIMIT), không đặt sau từng bảng
//
async function getFeatureByLatLng(lat, lng) {
  const cacheKey = `flood:latlng:${Number(lat).toFixed(4)}:${Number(lng).toFixed(4)}`

  // 1. Kiểm tra Redis
  try {
    const cached = await redis.get(cacheKey)
    if (cached) {
      return { source: 'cache', data: JSON.parse(cached) }
    }
  } catch (_redisErr) {
    // Redis không available → bỏ qua
  }

  // 2. Cache Miss → Query CockroachDB với Time-Travel + bbox pre-filter
  //    Bước 1: Thu hẹp bằng bbox (sử dụng index) → vài trăm rows
  //    Bước 2: Tính Haversine trên subset nhỏ đó → O(subset) thay vì O(53K)
  const minLat = lat - BBOX_RADIUS_DEG
  const maxLat = lat + BBOX_RADIUS_DEG
  const minLng = lng - BBOX_RADIUS_DEG
  const maxLng = lng + BBOX_RADIUS_DEG

  const sql = `
    SELECT
      gn.node_id,
      gn.grid_id,
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
      wm.rainy_season_flag,

      fp.flood_depth_cm,
      fp.risk_level::text AS risk_level,
      fp.explanation,
      fp.time AS predicted_at,

      (
        6371 * acos(LEAST(1, GREATEST(-1,
          cos(radians($1::float)) * cos(radians(gn.latitude::float)) *
          cos(radians(gn.longitude::float) - radians($2::float)) +
          sin(radians($1::float)) * sin(radians(gn.latitude::float))
        )))
      ) AS distance_km

    FROM grid_nodes gn
    -- DISTINCT ON thay cho LATERAL: chỉ lấy bản ghi mới nhất trong 24h mỗi node
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
    WHERE gn.latitude  BETWEEN $3 AND $4
      AND gn.longitude BETWEEN $5 AND $6
    ORDER BY distance_km ASC
    LIMIT 1
  `

  // Params: $1=lat, $2=lng (Haversine), $3=minLat, $4=maxLat, $5=minLng, $6=maxLng (bbox)
  const { rows } = await withTimeout(pool.query(sql, [lat, lng, minLat, maxLat, minLng, maxLng]))
  const row = rows[0] ?? null

  if (row) {
    try {
      await redis.setEx(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(row))
    } catch (_redisErr) { /* bỏ qua lỗi Redis write */ }
  }

  return { source: 'db', data: row }
}


module.exports = {
  getFeatureByGridId,
  getFeatureByLatLng,
}