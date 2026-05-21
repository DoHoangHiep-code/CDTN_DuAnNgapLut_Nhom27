'use strict'

/**
 * landslideCron.js — Landslide Batch Prediction Worker
 * ════════════════════════════════════════════════════════════════════════════
 * Schedule: 0 0,12 * * *  (0h và 12h hàng ngày, ICT)
 *
 * Thuật toán Batching (tối ưu RAM cho 425.180 nodes):
 *   1. Đếm tổng nodes trong DB → tính số lô.
 *   2. Mỗi lô 500 nodes: query LIMIT 500 OFFSET n từ landslide_grid_nodes.
 *   3. Nhóm nodes theo tỉnh → fetch Open-Meteo 1 lần/tỉnh (cache 13h).
 *   4. Kết hợp data tĩnh (DB) + data động (Open-Meteo) → rawFeatures.
 *   5. Gọi predictLandslide() (ONNX in-process, không HTTP).
 *   6. UPSERT kết quả vào landslide_predictions (bulk, 1 roundtrip/lô).
 *   7. Giải phóng mảng lô sau khi upsert → GC thu hồi RAM.
 *
 * Cột trong landslide_predictions (theo schema 04_landslide_schema.sql):
 *   id, node_id, prediction_time,
 *   rain_1d_accum, rain_3d_accum, rain_7d_accum, rain_14d_accum, rain_30d_accum,
 *   max_rain_1d_in_7d, max_rain_1d_in_3d,
 *   api_7d, api_14d, soil_moisture_1d, soil_moisture_7d,
 *   slope_x_deforestation, twi_x_rain7d, rain_intensity_ratio,
 *   prob_landslide, risk_level
 * ════════════════════════════════════════════════════════════════════════════
 */

require('dotenv').config()

const cron = require('node-cron')
const { Pool } = require('pg')

const { predictLandslide, getModelStatus } = require('../services/landslideInference')
const { fetchWeatherForNode, clearCache, sleep } = require('../services/OpenMeteoService')
const landslideCache = require('../../../utils/landslideCache')

// ── Pool riêng cho cron (tách biệt với pool của server để không tranh connection) ──
const pool = new Pool({
  connectionString: process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,                    // Giữ ít connection để không tranh với server chính
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
})
pool.on('error', (err) => console.error('[LandslideCron] Pool error:', err.message))

// ── Cấu hình ────────────────────────────────────────────────────────────────
const BATCH_SIZE          = 500    // nodes mỗi lô (LIMIT/OFFSET)
const SLEEP_BETWEEN_NODES = 120   // ms giữa mỗi node khi fetch weather (chống rate-limit)
const SLEEP_BETWEEN_BATCH = 2000  // ms giữa các lô (giảm tải DB)
const MAX_WEATHER_ERRORS  = 50    // dừng job nếu lỗi liên tiếp quá nhiều

// ── Guard: chỉ cho phép 1 job chạy cùng lúc ──────────────────────────────
let _isRunning = false

// ═════════════════════════════════════════════════════════════════════════════
// Bước 1: Query batch nodes từ DB (LIMIT + OFFSET, không load hết)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Lấy 1 lô nodes từ landslide_grid_nodes (không load toàn bộ 425K vào RAM).
 * Trả về tất cả cột data tĩnh cần cho model.
 *
 * @param {number} offset
 * @param {number} limit
 * @returns {Promise<Array>}
 */
async function fetchNodeBatch(offset, limit) {
  const { rows } = await pool.query(
    `SELECT
       node_id, province, location_name,
       lat, lon,
       elevation, slope, aspect, hillshade,
       curvature_plan, curvature_profile,
       tpi, tri, roughness, twi,
       dist_to_river_m, dist_to_road_m,
       ndvi, evi, ndwi, bsi, lulc_class
     FROM landslide_grid_nodes
     ORDER BY node_id
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  )
  return rows
}

/**
 * Đếm tổng số nodes.
 * @returns {Promise<number>}
 */
async function countTotalNodes() {
  const { rows } = await pool.query('SELECT COUNT(*) AS cnt FROM landslide_grid_nodes')
  return parseInt(rows[0].cnt, 10)
}

// ═════════════════════════════════════════════════════════════════════════════
// Bước 2: Build rawFeatures (kết hợp data tĩnh + data động)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Kết hợp dữ liệu tĩnh từ DB row với dữ liệu động từ Open-Meteo.
 * Mọi trường null/undefined sẽ được applyImputer() xử lý trong predictLandslide().
 *
 * @param {object} node — 1 row từ landslide_grid_nodes
 * @param {object|null} weather — kết quả từ fetchWeatherForNode hoặc null
 * @returns {object} rawFeatures
 */
function buildRawFeatures(node, weather) {
  return {
    // ── Data tĩnh (từ DB) ────────────────────────────────────────────────
    elevation:          parseFloat(node.elevation)         || null,
    slope:              parseFloat(node.slope)             || null,
    aspect:             parseFloat(node.aspect)            || null,
    hillshade:          parseFloat(node.hillshade)         || null,
    curvature_plan:     parseFloat(node.curvature_plan)    || null,
    curvature_profile:  parseFloat(node.curvature_profile) || null,
    tpi:                parseFloat(node.tpi)               || null,
    tri:                parseFloat(node.tri)               || null,
    roughness:          parseFloat(node.roughness)         || null,
    twi:                parseFloat(node.twi)               || null,
    dist_to_river_m:    parseFloat(node.dist_to_river_m)   || null,
    dist_to_road_m:     parseFloat(node.dist_to_road_m)    || null,
    ndvi:               parseFloat(node.ndvi)              || null,
    evi:                parseFloat(node.evi)               || null,
    ndwi:               parseFloat(node.ndwi)              || null,
    bsi:                parseFloat(node.bsi)               || null,
    lulc_class:         parseFloat(node.lulc_class)        || null,

    // ── Data động (từ Open-Meteo, null nếu fetch lỗi → imputer fill) ────
    rain_1d_accum:     weather?.rain_1d_accum     ?? null,
    rain_3d_accum:     weather?.rain_3d_accum     ?? null,
    rain_7d_accum:     weather?.rain_7d_accum     ?? null,
    rain_14d_accum:    weather?.rain_14d_accum    ?? null,
    rain_30d_accum:    weather?.rain_30d_accum    ?? null,
    max_rain_1d_in_7d: weather?.max_rain_1d_in_7d ?? null,
    max_rain_1d_in_3d: weather?.max_rain_1d_in_3d ?? null,
    api_7d:            weather?.api_7d            ?? null,
    api_14d:           weather?.api_14d           ?? null,
    soil_moisture_1d:  weather?.soil_moisture_1d  ?? null,
    soil_moisture_7d:  weather?.soil_moisture_7d  ?? null,

    // ── Biến tương tác (sẽ được addInteractionFeatures tính lại) ────────
    // Chỉ cần gửi các biến thô; interaction tính tự động trong predictLandslide()
    // Nhưng schema DB lưu 3 biến sau — tính sẵn để UPSERT
    slope_x_deforestation: (parseFloat(node.slope) || 0) *
                           (1 - Math.max(0, parseFloat(node.ndvi) || 0)),
    twi_x_rain7d:          (parseFloat(node.twi) || 0) * (weather?.rain_7d_accum ?? 0),
    rain_intensity_ratio:  (weather?.rain_1d_accum ?? 0) /
                           Math.max(weather?.rain_7d_accum ?? 1, 0.001),
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Bước 3: Bulk UPSERT kết quả vào landslide_predictions
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Bulk UPSERT 1 lô kết quả dự báo.
 * Dùng 1 câu INSERT VALUES(...),(...) thay vì N INSERT riêng lẻ.
 * ON CONFLICT → cập nhật tất cả trường (prediction mới nhất luôn thắng).
 *
 * @param {Array<{node_id: string, weather: object|null, prediction: object}>} batchResults
 * @param {Date} predictionTime
 * @returns {Promise<number>} Số rows đã upsert
 */
async function bulkUpsertPredictions(batchResults, predictionTime) {
  if (!batchResults.length) return 0

  const valueClauses = []
  const params = []
  let idx = 1

  for (const item of batchResults) {
    const { node_id, rawFeatures, prediction } = item

    valueClauses.push(
      `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, ` +
      `$${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, ` +
      `$${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, ` +
      `$${idx++}, $${idx++}, $${idx++})`
    )

    params.push(
      node_id,
      predictionTime,
      rawFeatures.rain_1d_accum    ?? null,
      rawFeatures.rain_3d_accum    ?? null,
      rawFeatures.rain_7d_accum    ?? null,
      rawFeatures.rain_14d_accum   ?? null,
      rawFeatures.rain_30d_accum   ?? null,
      rawFeatures.max_rain_1d_in_7d ?? null,
      rawFeatures.max_rain_1d_in_3d ?? null,
      rawFeatures.api_7d           ?? null,
      rawFeatures.api_14d          ?? null,
      rawFeatures.soil_moisture_1d ?? null,
      rawFeatures.soil_moisture_7d ?? null,
      rawFeatures.slope_x_deforestation ?? null,
      rawFeatures.twi_x_rain7d    ?? null,
      rawFeatures.rain_intensity_ratio ?? null,
      prediction.probability,                  // → prob_landslide
      prediction.risk_level                    // → risk_level
    )
  }

  const sql = `
    INSERT INTO landslide_predictions (
      node_id, prediction_time,
      rain_1d_accum, rain_3d_accum, rain_7d_accum, rain_14d_accum, rain_30d_accum,
      max_rain_1d_in_7d, max_rain_1d_in_3d,
      api_7d, api_14d,
      soil_moisture_1d, soil_moisture_7d,
      slope_x_deforestation, twi_x_rain7d, rain_intensity_ratio,
      prob_landslide, risk_level
    )
    VALUES ${valueClauses.join(', ')}
    ON CONFLICT (node_id, prediction_time) DO UPDATE SET
      rain_1d_accum         = EXCLUDED.rain_1d_accum,
      rain_3d_accum         = EXCLUDED.rain_3d_accum,
      rain_7d_accum         = EXCLUDED.rain_7d_accum,
      rain_14d_accum        = EXCLUDED.rain_14d_accum,
      rain_30d_accum        = EXCLUDED.rain_30d_accum,
      max_rain_1d_in_7d     = EXCLUDED.max_rain_1d_in_7d,
      max_rain_1d_in_3d     = EXCLUDED.max_rain_1d_in_3d,
      api_7d                = EXCLUDED.api_7d,
      api_14d               = EXCLUDED.api_14d,
      soil_moisture_1d      = EXCLUDED.soil_moisture_1d,
      soil_moisture_7d      = EXCLUDED.soil_moisture_7d,
      slope_x_deforestation = EXCLUDED.slope_x_deforestation,
      twi_x_rain7d          = EXCLUDED.twi_x_rain7d,
      rain_intensity_ratio  = EXCLUDED.rain_intensity_ratio,
      prob_landslide        = EXCLUDED.prob_landslide,
      risk_level            = EXCLUDED.risk_level
  `

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(sql, params)
    await client.query('COMMIT')
    return batchResults.length
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Hàm Job chính
// ═════════════════════════════════════════════════════════════════════════════

async function runLandslideJob() {
  // ── Guard: không chạy song song ──────────────────────────────────────────
  if (_isRunning) {
    console.log('[LandslideCron] ⏸️  Job trước chưa hoàn tất, bỏ qua lượt này.')
    return
  }

  // ── Kiểm tra model đã sẵn sàng ───────────────────────────────────────────
  const modelStatus = getModelStatus()
  if (!modelStatus.loaded) {
    console.warn('[LandslideCron] ⚠️  ONNX Model chưa load. Bỏ qua job cho đến khi model sẵn sàng.')
    return
  }

  _isRunning = true
  const jobStart = Date.now()
  console.log(`\n${'═'.repeat(65)}`)
  console.log(`[LandslideCron] ⏰ Bắt đầu lúc ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`)
  console.log(`[LandslideCron] Model threshold=${modelStatus.threshold} | features=${modelStatus.feature_count}`)

  // ── Xóa cache weather ở đầu mỗi chu kỳ để lấy data mới nhất ─────────────
  clearCache()

  let totalNodes = 0
  let totalSuccess = 0
  let totalError = 0
  let weatherErrorCount = 0
  const predictionTime = new Date()

  try {
    // Bước 0: Đếm tổng
    totalNodes = await countTotalNodes()
    const totalBatches = Math.ceil(totalNodes / BATCH_SIZE)
    console.log(`[LandslideCron] Tổng: ${totalNodes.toLocaleString('vi-VN')} nodes | ${totalBatches} lô × ${BATCH_SIZE}`)

    // ── Vòng lặp Batch ────────────────────────────────────────────────────
    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
      const offset = batchIdx * BATCH_SIZE
      const batchStart = Date.now()

      // Bước 1: Query lô nodes từ DB
      let nodes
      try {
        nodes = await fetchNodeBatch(offset, BATCH_SIZE)
      } catch (dbErr) {
        console.error(`[LandslideCron] ❌ Batch ${batchIdx + 1}: DB query lỗi:`, dbErr.message)
        totalError += BATCH_SIZE
        continue
      }

      if (!nodes.length) break

      // Bước 2: Nhóm nodes theo tỉnh để tối ưu số lần gọi Open-Meteo
      // Mỗi tỉnh chỉ gọi 1 lần → cache giúp tất cả nodes cùng tỉnh dùng chung
      // Fetch weather 1 lần cho mỗi node (vì tọa độ khác nhau, nhưng cache theo rounded lat/lon)
      const batchResults = []

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]

        // Dừng nếu quá nhiều lỗi weather liên tiếp
        if (weatherErrorCount >= MAX_WEATHER_ERRORS) {
          console.error(`[LandslideCron] ❌ Dừng: ${MAX_WEATHER_ERRORS} lỗi weather liên tiếp. Open-Meteo có thể bị down.`)
          break
        }

        // Fetch weather (có cache 13h, nên node cùng tỉnh hầu như không gọi thêm)
        let weather = null
        try {
          weather = await fetchWeatherForNode(
            parseFloat(node.lat),
            parseFloat(node.lon)
          )
          weatherErrorCount = 0  // Reset counter nếu fetch thành công
        } catch (wErr) {
          weatherErrorCount++
          // Không log từng lỗi để tránh spam log (đã log trong service)
        }

        // Bước 3: Build rawFeatures
        const rawFeatures = buildRawFeatures(node, weather)

        // Bước 4: Gọi ONNX model trực tiếp (in-process, không HTTP)
        let prediction
        try {
          prediction = await predictLandslide(rawFeatures)
        } catch (modelErr) {
          totalError++
          continue
        }

        batchResults.push({ node_id: node.node_id, rawFeatures, prediction })

        // Throttle nhẹ giữa các nodes để không spam Open-Meteo
        // Cache 13h đảm bảo hầu hết calls đã hit cache, sleep này chủ yếu cho cache miss đầu tiên
        if (i < nodes.length - 1) {
          await sleep(SLEEP_BETWEEN_NODES)
        }
      }

      // Bước 5: Bulk UPSERT lô kết quả
      if (batchResults.length > 0) {
        try {
          await bulkUpsertPredictions(batchResults, predictionTime)
          totalSuccess += batchResults.length
          
          // Cập nhật cache in-memory để API phục vụ siêu tốc
          landslideCache.updateCache(batchResults.map(r => ({
            node_id: r.node_id,
            prob_landslide: r.prediction.probability,
            risk_level: r.prediction.risk_level,
            rain_7d_accum: r.rawFeatures.rain_7d_accum,
            api_7d: r.rawFeatures.api_7d,
            soil_moisture_1d: r.rawFeatures.soil_moisture_1d,
            prediction_time: predictionTime
          })))
        } catch (upsertErr) {
          console.error(`[LandslideCron] ❌ Batch ${batchIdx + 1}: UPSERT lỗi:`, upsertErr.message)
          totalError += batchResults.length
        }
      }

      // Bước 6: Giải phóng RAM (GC sẽ thu hồi nodes và batchResults)
      nodes.length = 0
      batchResults.length = 0

      // Log tiến độ mỗi lô
      const processed = Math.min(offset + BATCH_SIZE, totalNodes)
      const batchMs = Date.now() - batchStart
      const pct = ((processed / totalNodes) * 100).toFixed(1)
      console.log(
        `[LandslideCron] Lô ${batchIdx + 1}/${totalBatches} | ` +
        `${processed.toLocaleString('vi-VN')}/${totalNodes.toLocaleString('vi-VN')} nodes (${pct}%) | ` +
        `${batchMs}ms`
      )

      // Dừng nếu weather errors vượt ngưỡng
      if (weatherErrorCount >= MAX_WEATHER_ERRORS) break

      // Nghỉ ngắn giữa các lô để tránh quá tải DB
      if (batchIdx < totalBatches - 1) {
        await sleep(SLEEP_BETWEEN_BATCH)
      }
    }
  } catch (unexpectedErr) {
    console.error('[LandslideCron] ❌ Lỗi không xử lý được:', unexpectedErr.message)
  } finally {
    _isRunning = false
  }

  const elapsed = ((Date.now() - jobStart) / 1000).toFixed(1)
  const dangerCount = totalSuccess > 0 ? await countByRiskLevel('DANGER', predictionTime) : 0
  const warningCount = totalSuccess > 0 ? await countByRiskLevel('WARNING', predictionTime) : 0

  console.log(`[LandslideCron] ✅ Hoàn tất: ${totalSuccess.toLocaleString('vi-VN')} OK | ${totalError.toLocaleString('vi-VN')} lỗi | ${elapsed}s`)
  console.log(`[LandslideCron] 📊 DANGER: ${dangerCount.toLocaleString('vi-VN')} | WARNING: ${warningCount.toLocaleString('vi-VN')}`)
  console.log(`${'═'.repeat(65)}\n`)
}

/**
 * Đếm số nodes theo risk_level trong lần chạy hiện tại.
 * @param {string} level
 * @param {Date} predTime
 * @returns {Promise<number>}
 */
async function countByRiskLevel(level, predTime) {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS cnt FROM landslide_predictions
       WHERE risk_level = $1
         AND prediction_time >= $2::timestamp - INTERVAL '30 minutes'`,
      [level, predTime]
    )
    return parseInt(rows[0].cnt, 10)
  } catch {
    return 0
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Đăng ký Cron & Export
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Đăng ký cron job: 0h và 12h hàng ngày (ICT).
 * Gọi 1 lần trong bootstrapAndStart() của server.js.
 */
function startLandslideCron() {
  cron.schedule('0 0,12 * * *', () => {
    runLandslideJob().catch((err) =>
      console.error('[LandslideCron] Unhandled error:', err.message)
    )
  }, { timezone: 'Asia/Ho_Chi_Minh' })

  console.log('[LandslideCron] ✅ Đã đăng ký cron: 0h và 12h hàng ngày (ICT).')
}

/**
 * Chạy thử 1 lô đầu tiên (500 nodes) để kiểm tra toàn bộ pipeline.
 * Dùng khi dev/test: node -e "require('./src/modules/landslide/cron/landslideCron').runFirstBatchTest()"
 */
async function runFirstBatchTest() {
  console.log('\n[LandslideCron TEST] Khởi động test 1 lô đầu (500 nodes)...')

  // Trong test mode cần load model trước
  const { initLandslideModel, getModelStatus } = require('../services/landslideInference')
  if (!getModelStatus().loaded) {
    try {
      await initLandslideModel()
    } catch (err) {
      console.error('[LandslideCron TEST] ❌ Không load được model:', err.message)
      return
    }
  }

  const predictionTime = new Date()

  // Chỉ chạy 1 lô
  let nodes
  try {
    nodes = await fetchNodeBatch(0, BATCH_SIZE)
    console.log(`[LandslideCron TEST] Query ${nodes.length} nodes từ DB. OK`)
  } catch (err) {
    console.error('[LandslideCron TEST] ❌ DB query lỗi:', err.message)
    await pool.end()
    return
  }

  let successCount = 0
  let errorCount = 0
  const batchResults = []

  for (let i = 0; i < Math.min(nodes.length, 10); i++) {  // Test 10 nodes đầu để nhanh
    const node = nodes[i]
    console.log(`  [${i + 1}/10] node_id=${node.node_id} | lat=${node.lat} | lon=${node.lon} | province=${node.province}`)

    let weather = null
    try {
      weather = await fetchWeatherForNode(parseFloat(node.lat), parseFloat(node.lon))
      console.log(`    Weather: rain_7d=${weather?.rain_7d_accum ?? 'null'} | soil_1d=${weather?.soil_moisture_1d ?? 'null'}`)
    } catch (err) {
      console.warn(`    Weather FAIL: ${err.message}`)
    }

    const rawFeatures = buildRawFeatures(node, weather)
    let prediction
    try {
      prediction = await predictLandslide(rawFeatures)
      console.log(`    Predict: prob=${prediction.probability} | risk=${prediction.risk_level}`)
      batchResults.push({ node_id: node.node_id, rawFeatures, prediction })
      successCount++
    } catch (err) {
      console.error(`    Predict FAIL: ${err.message}`)
      errorCount++
    }

    await sleep(SLEEP_BETWEEN_NODES)
  }

  console.log(`\n[LandslideCron TEST] Sample kết quả: ${successCount} thành công / ${errorCount} lỗi`)

  if (batchResults.length > 0) {
    try {
      const upserted = await bulkUpsertPredictions(batchResults, predictionTime)
      console.log(`[LandslideCron TEST] ✅ UPSERT ${upserted} rows vào landslide_predictions: OK`)
    } catch (err) {
      console.error(`[LandslideCron TEST] ❌ UPSERT lỗi:`, err.message)
    }
  }

  await pool.end()
  console.log('[LandslideCron TEST] Done.\n')
}

module.exports = { startLandslideCron, runLandslideJob, runFirstBatchTest }
