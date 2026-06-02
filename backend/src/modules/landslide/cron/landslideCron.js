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
const { invalidateCacheNamespace } = require('../../../middlewares/apiCache')
const { SystemLog } = require('../../../models')

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
 * @param {Array<{node_id: string, rawFeatures: object, prediction: object, predDate: Date}>} batchResults
 * @returns {Promise<number>} Số rows đã upsert
 */
async function bulkUpsertPredictions(batchResults) {
  if (!batchResults.length) return 0

  const CHUNK_SIZE = 3000
  let totalUpserted = 0

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    for (let c = 0; c < batchResults.length; c += CHUNK_SIZE) {
      const chunk = batchResults.slice(c, c + CHUNK_SIZE)

      const valueClauses = []
      const params = []
      let idx = 1

      for (const item of chunk) {
        const { node_id, rawFeatures, prediction, predDate } = item

        valueClauses.push(
          `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, ` +
          `$${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, ` +
          `$${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, ` +
          `$${idx++}, $${idx++}, $${idx++})`
        )

        params.push(
          node_id,
          predDate,
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

      await client.query(sql, params)
      totalUpserted += chunk.length
    }

    await client.query('COMMIT')
    return totalUpserted
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
  const { initLandslideModel } = require('../services/landslideInference')
  const modelStatus = getModelStatus()
  if (!modelStatus.loaded) {
    try {
      console.log('[LandslideCron] 🔄 Đang load ONNX Model (Standalone Mode)...')
      await initLandslideModel()
    } catch (err) {
      console.error('[LandslideCron] ❌ Không thể load ONNX Model:', err.message)
      return
    }
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
  const predictionTime = new Date()
  predictionTime.setMinutes(0, 0, 0) // Làm tròn về đầu giờ (VD: 9:04 -> 9:00) để ghi đè ON CONFLICT

  try {
    // Bước 0: Đếm tổng
    totalNodes = await countTotalNodes()
    // Tăng BATCH_SIZE lên 50k cho Phase 1 và 3 vì không gọi HTTP
    const READ_BATCH_SIZE = 50000 
    const totalBatches = Math.ceil(totalNodes / READ_BATCH_SIZE)
    console.log(`[LandslideCron] Tổng: ${totalNodes.toLocaleString('vi-VN')} nodes | ${totalBatches} lô đọc × ${READ_BATCH_SIZE}`)

    // =========================================================================
    // PHASE 1: Đọc dữ liệu tĩnh & Grid Snapping (RAM-based)
    // =========================================================================
    console.log(`[LandslideCron] 🔄 Phase 1: Grid Snapping & Lọc Trạm Ảo...`)
    const virtualStationsMap = new Map() // Key: "lat_lon", Value: { id, lat, lon }
    
    // Đọc lô 50k một lần để không quá tải RAM
    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
      const offset = batchIdx * READ_BATCH_SIZE
      const nodes = await fetchNodeBatch(offset, READ_BATCH_SIZE)
      
      for (const node of nodes) {
        // Thuật toán Snapping: Làm tròn 1 chữ số thập phân (~11km)
        const rLat = Math.round(parseFloat(node.lat) * 10) / 10
        const rLon = Math.round(parseFloat(node.lon) * 10) / 10
        const vsId = `${rLat.toFixed(1)}_${rLon.toFixed(1)}`
        
        if (!virtualStationsMap.has(vsId)) {
          virtualStationsMap.set(vsId, { id: vsId, lat: rLat, lon: rLon })
        }
      }
    }
    
    const virtualStations = Array.from(virtualStationsMap.values())
    console.log(`[LandslideCron] ✅ Phase 1 OK: Nén ${totalNodes.toLocaleString('vi-VN')} điểm thành ${virtualStations.length.toLocaleString('vi-VN')} Trạm Ảo.`)

    // =========================================================================
    // PHASE 2: Fetch Weather (Multi-Location Batching)
    // =========================================================================
    console.log(`[LandslideCron] ☁️  Phase 2: Fetching Open-Meteo cho ${virtualStations.length} trạm...`)
    const { fetchWeatherForMultipleNodes } = require('../services/OpenMeteoService')
    const weatherDictionary = await fetchWeatherForMultipleNodes(virtualStations)
    console.log(`[LandslideCron] ✅ Phase 2 OK: Cache Dictionary đã nạp xong (Size: ${weatherDictionary.size})`)

    // =========================================================================
    // PHASE 3: Lấy lại DB & Ánh xạ & Dự báo & UPSERT
    // =========================================================================
    console.log(`[LandslideCron] ⚙️  Phase 3: Ánh xạ, Dự báo & Cập nhật DB...`)
    const allPredictions = [] // Lưu vào RAM để cập nhật in-memory cache cuối cùng
    
    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
      const offset = batchIdx * READ_BATCH_SIZE
      const nodes = await fetchNodeBatch(offset, READ_BATCH_SIZE)
      const batchResults = []

      for (const node of nodes) {
        // Ánh xạ lại Virtual Station ID
        const rLat = Math.round(parseFloat(node.lat) * 10) / 10
        const rLon = Math.round(parseFloat(node.lon) * 10) / 10
        const vsId = `${rLat.toFixed(1)}_${rLon.toFixed(1)}`
        
        // Lookup weather dictionary O(1) - trả về mảng 4 ngày
        const weathers = weatherDictionary.get(vsId) || [null, null, null, null]
        const weatherArray = Array.isArray(weathers) ? weathers : [weathers, weathers, weathers, weathers]

        for (let offset = 0; offset <= 3; offset++) {
          // Bắt buộc áp dụng bộ lọc độ dốc (Slope > 15 độ) trước khi đưa vào vòng lặp Phase 3 cho 3 ngày tương lai.
          if (offset > 0) {
            const slope = parseFloat(node.slope) || 0
            if (slope <= 15) continue
          }

          const weather = weatherArray[offset]
          // Build rawFeatures (Imputer trong model sẽ tự xử lý weather=null)
          const rawFeatures = buildRawFeatures(node, weather)

          // Tính toán predDate
          const predDate = new Date(predictionTime)
          predDate.setDate(predDate.getDate() + offset)

          // Gọi model dự báo
          let prediction
          try {
            prediction = await predictLandslide(rawFeatures)
            batchResults.push({ 
              node_id: node.node_id, 
              province: node.province, 
              lat: parseFloat(node.lat),
              lon: parseFloat(node.lon),
              location_name: node.location_name,
              slope: parseFloat(node.slope),
              elevation: parseFloat(node.elevation),
              rawFeatures, prediction, predDate, offset 
            })
          } catch (modelErr) {
            totalError++
            continue
          }
        }
      }

      // UPSERT cho từng lô 50k
      if (batchResults.length > 0) {
        try {
          await bulkUpsertPredictions(batchResults)
          totalSuccess += batchResults.length
          // Chú ý chỉ lưu offset = 0 vào cache in-memory để phục vụ API real-time mặc định
          allPredictions.push(...batchResults.filter(r => r.offset === 0))
        } catch (upsertErr) {
          console.error(`[LandslideCron] ❌ Lỗi UPSERT Phase 3 (lô ${batchIdx + 1}):`, upsertErr.message)
          totalError += batchResults.length
        }
      }

      console.log(`[LandslideCron]   └ Phase 3: Lô ${batchIdx + 1}/${totalBatches} hoàn tất (${batchResults.length} điểm).`)
    }

    // Gọi updateCache (in-memory) cho các nodes mới nhất (Phase 3)
    const landslideCache = require('../../../utils/landslideCache')
    landslideCache.updateCache(allPredictions.map(r => ({
      node_id: r.node_id,
      province: r.province,
      lat: r.lat,
      lon: r.lon,
      location_name: r.location_name,
      slope: r.slope,
      elevation: r.elevation,
      prob_landslide: r.prediction.probability,
      risk_level: r.prediction.risk_level,
      rain_7d_accum: r.rawFeatures.rain_7d_accum,
      api_7d: r.rawFeatures.api_7d,
      soil_moisture_1d: r.rawFeatures.soil_moisture_1d,
      prediction_time: predictionTime
    })))

    // Cập nhật cả chatbot cache
    landslideCache.populateChatbotCache(pool).catch(err => console.error('[LandslideCron] populateChatbotCache error:', err.message))


    // Xóa cache API HTTP (node-cache) để bắt buộc tạo lại (Gọi Webhook sang tiến trình chính)
    try {
      const http = require('http')
      const req = http.request({
        hostname: 'localhost',
        port: process.env.PORT || 3002,
        path: '/api/v1/landslide/clear-cache',
        method: 'POST'
      }, (res) => {
        console.log(`[LandslideCron] 🧹 Gọi Webhook Clear Cache thành công: HTTP ${res.statusCode}`)
      })
      req.on('error', (e) => console.log(`[LandslideCron] Webhook error (nếu server tắt thì bỏ qua): ${e.message}`))
      req.end()
    } catch(err) {}

    console.log(`\n[LandslideCron] 🎉 HOÀN TẤT DỰ BÁO LÚC ${new Date().toLocaleTimeString('vi-VN')}`)

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

  try {
    const isPartialSuccess = totalError > 0
    const logPrefix = isPartialSuccess ? 'WARN: Cronjob Partial Success' : 'Cronjob OK'
    const eventType = isPartialSuccess ? 'CRONJOB_LANDSLIDE_WARN' : 'CRONJOB_LANDSLIDE'

    await SystemLog.create({
      admin_id:     null,
      event_type:   eventType,
      event_source: 'modules/landslide/cron/landslideCron (ONNX in-process)',
      message:      `${logPrefix}: total_nodes=${totalNodes}, success=${totalSuccess}, error=${totalError}, danger=${dangerCount}, warning=${warningCount}, elapsed=${elapsed}s`,
      timestamp:    new Date(),
    })
  } catch (logErr) {
    console.warn('[LandslideCron] Không ghi được SystemLog:', logErr.message)
  }
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

    if (!weather || !weather._cached) {
      await sleep(SLEEP_BETWEEN_NODES)
    }
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
