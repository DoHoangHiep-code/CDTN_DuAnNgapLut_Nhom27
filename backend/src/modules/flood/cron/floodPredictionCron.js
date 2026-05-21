'use strict'

/**
 * floodPredictionCron.js – Background Worker: Cập nhật dự báo ngập lụt tự động
 * ─────────────────────────────────────────────────────────────────────────────
 * Schedule: Mỗi 10 phút
 *
 * PERF OPT (2026-05-08):
 *  1. CHUNK_SIZE tăng 500 → 1000 (CatBoost batch rất nhanh)
 *  2. Chunks chạy song song theo nhóm PARALLEL_WORKERS=4 (thay vì tuần tự)
 *     → giảm 106s xuống ~25s với 53K nodes
 *  3. Bulk INSERT với VALUES($1,$2...) thay vì N INSERT riêng lẻ
 *     → giảm N DB roundtrips xuống 1 per chunk
 *  4. AS OF SYSTEM TIME đặt đúng vị trí (cuối câu lệnh)
 */

require('dotenv').config()

const cron = require('node-cron')
const axios = require('axios')
const { Pool } = require('pg')

// Shared in-memory cache – chatbot đọc từ đây thay vì query DB
let floodCache = null
try {
  floodCache = require('../../../utils/floodCache')
} catch (_) {
  console.warn('[PredictionCron] floodCache không tải được, chatbot cache bị vô hiệu hóa.')
}

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000'
const AI_BATCH_TIMEOUT_MS = 300_000
const CHUNK_SIZE = 1000
const PARALLEL_WORKERS = 2

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 8,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
})
pool.on('error', (err) => console.error('[PredictionCron] Pool error:', err.message))

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildFeatureVector(row) {
  const now = new Date()
  const hour = Number(row.hour ?? now.getHours())
  const month = Number(row.month ?? now.getMonth() + 1)
  const startOfYear = new Date(now.getFullYear(), 0, 0)
  const dayofyear = Math.floor((now - startOfYear) / 86_400_000)
  const dayofweek = now.getDay()
  return {
    prcp: Number(row.prcp ?? 0), prcp_3h: Number(row.prcp_3h ?? 0),
    prcp_6h: Number(row.prcp_6h ?? 0), prcp_12h: Number(row.prcp_12h ?? 0),
    prcp_24h: Number(row.prcp_24h ?? 0), temp: Number(row.temp ?? 28),
    rhum: Number(row.rhum ?? 70), wspd: Number(row.wspd ?? 0),
    pres: Number(row.pres ?? 1010), pressure_change_24h: Number(row.pressure_change_24h ?? 0),
    max_prcp_3h: Number(row.max_prcp_3h ?? 0), max_prcp_6h: Number(row.max_prcp_6h ?? 0),
    max_prcp_12h: Number(row.max_prcp_12h ?? 0), elevation: Number(row.elevation ?? 5),
    slope: Number(row.slope ?? 1), impervious_ratio: Number(row.impervious_ratio ?? 0.5),
    dist_to_drain_km: Number(row.dist_to_drain_km ?? 0.5),
    dist_to_river_km: Number(row.dist_to_river_km ?? 1),
    dist_to_pump_km: Number(row.dist_to_pump_km ?? 1),
    dist_to_main_road_km: Number(row.dist_to_main_road_km ?? 0.3),
    dist_to_park_km: Number(row.dist_to_park_km ?? 0.5),
    hour, dayofweek, month, dayofyear,
    hour_sin: Math.sin((2 * Math.PI * hour) / 24),
    hour_cos: Math.cos((2 * Math.PI * hour) / 24),
    month_sin: Math.sin((2 * Math.PI * month) / 12),
    month_cos: Math.cos((2 * Math.PI * month) / 12),
    rainy_season_flag: (row.rainy_season_flag === true || row.rainy_season_flag === 1) ? 1 : 0,
  }
}

function depthToRisk(depthCm) {
  if (depthCm < 5) return 'safe'
  if (depthCm < 20) return 'medium'
  if (depthCm < 50) return 'high'
  return 'severe'
}

function chunkArray(arr, size) {
  const chunks = []
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size))
  return chunks
}

/**
 * Bulk upsert một chunk predictions vào DB bằng 1 câu INSERT VALUES(...),(...),...
 * Thay thế vòng lặp N INSERT riêng lẻ → giảm N roundtrips xuống 1.
 */
async function bulkUpsertChunk(nodeIds, predictions, predictTime) {
  if (!nodeIds.length) return

  const explanation = `Cron tự động – ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`

  // Xây dựng VALUES clause: ($1,$2,$3,$4,$5),($6,$7,$8,$9,$10),...
  const valueClauses = []
  const params = []
  let paramIdx = 1

  for (let j = 0; j < nodeIds.length; j++) {
    const pred = predictions[j]
    if (!pred) continue
    const depthCm = Math.max(0, Number(pred.flood_depth_cm ?? 0))
    const riskLevel = pred.risk_level ?? depthToRisk(depthCm)

    valueClauses.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4})`)
    params.push(nodeIds[j], predictTime, depthCm, riskLevel, explanation)
    paramIdx += 5
  }

  if (!valueClauses.length) return

  const sql = `
    INSERT INTO flood_predictions (node_id, time, flood_depth_cm, risk_level, explanation)
    VALUES ${valueClauses.join(', ')}
    ON CONFLICT (node_id, time) DO UPDATE SET
      flood_depth_cm = EXCLUDED.flood_depth_cm,
      risk_level     = EXCLUDED.risk_level,
      explanation    = EXCLUDED.explanation
  `

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(sql, params)
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function processChunk(chunk, nodeIds, chunkIndex, totalChunks) {
  let predictions = null;
  let attempts = 0;
  const maxAttempts = 2; // 1 normal + 1 retry

  while (attempts < maxAttempts) {
    attempts++;
    try {
      const res = await axios.post(`${AI_SERVICE_URL}/api/predict/batch`, chunk, {
        timeout: AI_BATCH_TIMEOUT_MS,
        headers: { 'Content-Type': 'application/json' },
      });
      predictions = res.data;
      break; // Success, break out of retry loop
    } catch (err) {
      if (attempts >= maxAttempts) {
        console.error(`[PredictionCron] ❌ Chunk ${chunkIndex + 1}/${totalChunks} AI lỗi sau ${maxAttempts} lần thử:`, err.message);
        return { success: 0, error: chunk.length };
      }
      console.warn(`[PredictionCron] ⚠️ Chunk ${chunkIndex + 1}/${totalChunks} AI lỗi (${err.message}). Thử lại lần ${attempts + 1}...`);
      await new Promise(resolve => setTimeout(resolve, 3000)); // wait 3s before retry
    }
  }

  // Bulk upsert
  try {
    const predictTime = new Date();
    
    // Áp dụng logic No-Rain Override: nếu không có mưa và độ ẩm < 90% thì độ ngập = 0
    const NO_RAIN_HUMIDITY_THRESHOLD = 90;
    for (let j = 0; j < predictions.length; j++) {
      const features = chunk[j];
      if (
        features && 
        features.prcp === 0 && 
        features.prcp_3h === 0 && 
        features.prcp_6h === 0 && 
        features.prcp_12h === 0 && 
        features.prcp_24h === 0 && 
        features.rhum < NO_RAIN_HUMIDITY_THRESHOLD
      ) {
         predictions[j].flood_depth_cm = 0;
         predictions[j].risk_level = 'safe';
         predictions[j].explanation = 'Không có mưa trong 24h qua, khu vực hiện đang an toàn.';
      }
    }

    await bulkUpsertChunk(nodeIds, predictions, predictTime);
    return { success: nodeIds.length, error: 0 };
  } catch (err) {
    console.error(`[PredictionCron] ❌ Chunk ${chunkIndex + 1}/${totalChunks} DB upsert lỗi:`, err.message);
    return { success: 0, error: nodeIds.length };
  }
}

// ─── Hàm cron chính ───────────────────────────────────────────────────────────

async function runFloodPredictionJob() {
  if (global.isWeatherCronRunning) {
    console.log('\n[PredictionCron] ⏸️ Tạm dừng: WeatherCron (trình nạp dữ liệu DB) đang chạy. Sẽ thử lại ở chu kỳ 10 phút sau.');
    return;
  }

  const startTime = Date.now()
  console.log(`\n[PredictionCron] ⏰ Bắt đầu lúc ${new Date().toISOString()}`)

  // Bước 1: Lấy tất cả nodes + weather mới nhất
  let nodes
  try {
    const sql = `
      SELECT
        gn.node_id, gn.elevation, gn.slope, gn.impervious_ratio,
        gn.dist_to_drain_km, gn.dist_to_river_km, gn.dist_to_pump_km,
        gn.dist_to_main_road_km, gn.dist_to_park_km,
        wm.temp, wm.rhum, wm.prcp, wm.prcp_3h, wm.prcp_6h, wm.prcp_12h,
        wm.prcp_24h, wm.wspd, wm.pres, wm.pressure_change_24h,
        wm.max_prcp_3h, wm.max_prcp_6h, wm.max_prcp_12h,
        wm.month, wm.hour, wm.rainy_season_flag
      FROM grid_nodes gn
      LEFT JOIN (
        SELECT DISTINCT ON (node_id) *
        FROM weather_measurements
        WHERE time >= NOW() - INTERVAL '24 hours'
        ORDER BY node_id, time DESC
      ) wm ON gn.node_id = wm.node_id
    `
    const { rows } = await pool.query(sql)
    nodes = rows
    console.log(`[PredictionCron] Đã lấy ${nodes.length.toLocaleString('vi-VN')} nodes từ DB.`)
  } catch (err) {
    console.error('[PredictionCron] ❌ Lỗi query nodes:', err.message)
    return
  }

  if (!nodes.length) { console.log('[PredictionCron] ℹ️  Không có node nào.'); return }

  // Bước 2: Build feature vectors + chia chunks
  const featureVectors = nodes.map(buildFeatureVector)
  const chunks = chunkArray(featureVectors, CHUNK_SIZE)
  const nodeIdChunks = chunkArray(nodes.map(n => n.node_id), CHUNK_SIZE)

  console.log(`[PredictionCron] ${chunks.length} chunks × ${CHUNK_SIZE} nodes, PARALLEL_WORKERS=${PARALLEL_WORKERS}`)

  // Bước 3: Xử lý song song theo nhóm PARALLEL_WORKERS
  let totalSuccess = 0
  let totalError = 0

  for (let i = 0; i < chunks.length; i += PARALLEL_WORKERS) {
    const groupChunks = chunks.slice(i, i + PARALLEL_WORKERS)
    const groupNodeIds = nodeIdChunks.slice(i, i + PARALLEL_WORKERS)

    const results = await Promise.allSettled(
      groupChunks.map((chunk, gi) => processChunk(chunk, groupNodeIds[gi], i + gi, chunks.length))
    )

    results.forEach(r => {
      if (r.status === 'fulfilled') {
        totalSuccess += r.value.success
        totalError += r.value.error
      } else {
        totalError += CHUNK_SIZE
      }
    })

    const done = Math.min(i + PARALLEL_WORKERS, chunks.length)
    console.log(`[PredictionCron]   → Chunk ${done}/${chunks.length} hoàn tất (${totalSuccess.toLocaleString('vi-VN')} nodes OK)`)
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`[PredictionCron] ✅ Hoàn tất: ${totalSuccess.toLocaleString('vi-VN')} thành công, ${totalError.toLocaleString('vi-VN')} lỗi. Thời gian: ${elapsed}s\n`)

  // Cập nhật In-Memory Cache sau khi bulk upsert xong
  // Dùng ghi đè (=) theo quy tắc của floodCache.update() – KHÔNG dùng .push()
  if (floodCache && totalSuccess > 0) {
    await updateFloodCache()
    
    // Refresh Materialized Views (Dashboard charts)
    console.log('[PredictionCron] Đang làm mới Materialized Views...')
    try {
      await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_latest_flood_predictions;')
      await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_global_risk_trend;')
      await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_global_flood_avg;')
      console.log('[PredictionCron] ✅ Đã làm mới xong Materialized Views.')
    } catch (err) {
      console.error('[PredictionCron] ❌ Lỗi refresh Materialized Views:', err.message)
      try {
        await pool.query('REFRESH MATERIALIZED VIEW mv_latest_flood_predictions;')
        await pool.query('REFRESH MATERIALIZED VIEW mv_global_risk_trend;')
        await pool.query('REFRESH MATERIALIZED VIEW mv_global_flood_avg;')
        console.log('[PredictionCron] ✅ Đã làm mới xong Materialized Views (non-concurrent).')
      } catch (e2) {
        console.error('[PredictionCron] ❌ Fatal lỗi refresh Materialized Views:', e2.message)
      }
    }
  }
}

// ─── Cập nhật In-Memory Cache ────────────────────────────────────────────────────
/**
 * Query top data từ DB và đẩy vào floodCache dưới dạng ghi đè hoàn toàn.
 * QUY TẮc: LUON dùng floodCache.update(payload) – KHÔNG .push() từng phần tử.
 * Vi dụ: floodCache.worstAreas = newData   ← ĐÚNG
 *          floodCache.worstAreas.push(item)  ← SAI (Memory Leak!)
 */
async function updateFloodCache() {
  try {
    // Query song song cả 3 tập dữ liệu
    const [worstRes, statusRes, summaryRes] = await Promise.all([
      pool.query(`
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
      `),
      pool.query(`
        SELECT sub.node_id, sub.risk_level, sub.flood_depth_cm, sub.explanation, sub.time,
               gn.latitude, gn.longitude, gn.location_name
        FROM (
          SELECT DISTINCT ON (node_id)
            node_id, risk_level, flood_depth_cm, explanation, time
          FROM flood_predictions
          WHERE time >= NOW() - INTERVAL '2 hours'
            AND risk_level IN ('high', 'severe')
          ORDER BY node_id, time DESC
        ) sub
        JOIN grid_nodes gn ON gn.node_id = sub.node_id
        ORDER BY sub.flood_depth_cm DESC
        LIMIT 10
      `),
      pool.query(`
        SELECT sub.risk_level,
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
      `),
    ])

    // Ghi đè hoàn toàn qua floodCache.update() – KHÔNG .push()
    floodCache.update({
      worstAreas: worstRes.rows,
      currentStatus: statusRes.rows,
      forecastSummary: summaryRes.rows,
    })
  } catch (err) {
    console.error('[PredictionCron] ⚠️  updateFloodCache lỗi (cache giữ nguyên):', err.message)
  }
}

// ─── Đăng ký Cron Job ─────────────────────────────────────────────────────────

function startFloodPredictionCron() {
  cron.schedule('*/10 * * * *', () => {
    runFloodPredictionJob().catch((err) =>
      console.error('[PredictionCron] Unhandled error:', err.message)
    )
  }, { timezone: 'Asia/Ho_Chi_Minh' })

  console.log('[PredictionCron] ✅ Đã đăng ký cron: mỗi 10 phút (ICT).')
  console.log('[PredictionCron] Chạy lần đầu ngay khi khởi động...')
  runFloodPredictionJob().catch((err) =>
    console.error('[PredictionCron] Lần chạy đầu lỗi:', err.message)
  )
}

module.exports = { startFloodPredictionCron, runFloodPredictionJob }
