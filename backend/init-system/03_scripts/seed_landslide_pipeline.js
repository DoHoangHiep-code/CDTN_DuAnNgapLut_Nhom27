const fs = require('fs')
const path = require('path')
const csv = require('csv-parser')
const { Pool } = require('pg')
const axios = require('axios')
require('dotenv').config()

// 1. Chuẩn bị thư viện và Kết nối DB
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

// Hàm sleep để delay (tránh rate-limit)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// ─────────────────────────────────────────────────────────────
// PHASE 1: Import Data Tĩnh từ CSV vào landslide_grid_nodes
// ─────────────────────────────────────────────────────────────
async function importStaticData() {
  console.log('--- BẮT ĐẦU PHASE 1: IMPORT DỮ LIỆU TĨNH ---')
  const csvFilePath = path.join(__dirname, '..', '02_static_data', 'grid_prediction_datv2.csv')

  if (!fs.existsSync(csvFilePath)) {
    console.error(`Không tìm thấy file CSV tại: ${csvFilePath}`)
    return false
  }

  const batchSize = 2000 // 2000 * 19 = 38000 placeholders, an toàn trong giới hạn PG 65535
  let batch = []
  let totalImported = 0

  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(csvFilePath).pipe(csv())
    stream
      .on('data', async (row) => {
        batch.push({
          province: row.province || null,
          lat: parseFloat(row.lat) || 0,
          lon: parseFloat(row.lon) || 0,
          elevation: parseFloat(row.elevation) || 0,
          slope: parseFloat(row.slope) || 0,
          aspect: parseFloat(row.aspect) || 0,
          hillshade: parseFloat(row.hillshade) || 0,
          curvature_plan: parseFloat(row.curvature_plan) || 0,
          curvature_profile: parseFloat(row.curvature_profile) || 0,
          tpi: parseFloat(row.tpi) || 0,
          tri: parseFloat(row.tri) || 0,
          roughness: parseFloat(row.roughness) || 0,
          twi: parseFloat(row.twi) || 0,
          dist_to_river_m: parseFloat(row.dist_to_river_m) || 0,
          ndvi: parseFloat(row.ndvi) || 0,
          evi: parseFloat(row.evi) || 0,
          ndwi: parseFloat(row.ndwi) || 0,
          bsi: parseFloat(row.bsi) || 0,
          lulc_class: parseInt(row.lulc_class) || 0,
          dist_to_road_m: parseFloat(row.dist_to_road_m) || 0
        })

        if (batch.length >= batchSize) {
          stream.pause()
          const currentBatch = [...batch]
          batch = []
          await processBatch(currentBatch)
          stream.resume()
        }
      })
      .on('end', async () => {
        if (batch.length > 0) await processBatch(batch)
        console.log(`Đã import xong tổng cộng ${totalImported} dòng Data tĩnh.`)
        resolve(true)
      })
      .on('error', (err) => {
        console.error('Lỗi khi đọc file CSV:', err)
        reject(err)
      })

    async function processBatch(nodes) {
      if (nodes.length === 0) return
      try {
        const values = []
        const queryPlaceholders = []
        nodes.forEach((node, i) => {
          const o = i * 20
          queryPlaceholders.push(`($${o+1}, $${o+2}, $${o+3}, $${o+4}, $${o+5}, $${o+6}, $${o+7}, $${o+8}, $${o+9}, $${o+10}, $${o+11}, $${o+12}, $${o+13}, $${o+14}, $${o+15}, $${o+16}, $${o+17}, $${o+18}, $${o+19}, $${o+20})`)
          values.push(node.province, node.lat, node.lon, node.elevation, node.slope, node.aspect,
            node.hillshade, node.curvature_plan, node.curvature_profile,
            node.tpi, node.tri, node.roughness, node.twi, node.dist_to_river_m,
            node.ndvi, node.evi, node.ndwi, node.bsi, node.lulc_class, node.dist_to_road_m)
        })
        await pool.query(`
          INSERT INTO landslide_grid_nodes (
            province, lat, lon, elevation, slope, aspect, hillshade, curvature_plan, curvature_profile,
            tpi, tri, roughness, twi, dist_to_river_m, ndvi, evi, ndwi, bsi, lulc_class, dist_to_road_m
          ) VALUES ${queryPlaceholders.join(',')}
          ON CONFLICT DO NOTHING
        `, values)
        totalImported += nodes.length
        console.log(`Đã import xong ${totalImported} dòng Data tĩnh...`)
      } catch (err) {
        console.error('Lỗi khi chèn batch vào DB:', err.message)
      }
    }
  })
}

// ─────────────────────────────────────────────────────────────
// PHASE 2: Fetch Open-Meteo theo Zone Clustering
// Chiến lược: Nhóm 425K điểm theo ô địa lý 1°×1° (~110km)
// → chỉ ~80 API calls/lần chạy → Không bao giờ bị 429!
// ─────────────────────────────────────────────────────────────
async function processDynamicData() {
  console.log('--- BẮT ĐẦU PHASE 2: FETCH API & FEATURE ENGINEERING (Zone Clustering) ---')
  try {
    const result = await pool.query('SELECT node_id, lat, lon, twi, slope, ndvi FROM landslide_grid_nodes')
    const nodes = result.rows
    const totalNodes = nodes.length
    console.log(`Tìm thấy ${totalNodes} điểm lưới. Đang nhóm theo vùng địa lý 1°×1°...`)

    // Nhóm các node theo ô địa lý
    const zoneMap = new Map()
    for (const node of nodes) {
      const zoneKey = `${Math.floor(node.lat)}_${Math.floor(node.lon)}`
      if (!zoneMap.has(zoneKey)) {
        zoneMap.set(zoneKey, {
          nodes: [],
          centerLat: Math.floor(node.lat) + 0.5,
          centerLon: Math.floor(node.lon) + 0.5
        })
      }
      zoneMap.get(zoneKey).nodes.push(node)
    }

    const zones = Array.from(zoneMap.values())
    console.log(`Tổng ${zones.length} vùng địa lý duy nhất → Chỉ cần ${zones.length} API calls!`)

    // Tính khoảng ngày 30 ngày qua
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(endDate.getDate() - 30)
    const fmt = (d) => d.toISOString().split('T')[0]
    console.log(`Lấy dữ liệu từ ${fmt(startDate)} đến ${fmt(endDate)} (Archive API)`)

    let processedNodes = 0

    for (let z = 0; z < zones.length; z++) {
      const zone = zones[z]
      console.log(`[${z + 1}/${zones.length}] Vùng (${zone.centerLat.toFixed(1)}, ${zone.centerLon.toFixed(1)}) → ${zone.nodes.length} điểm`)

      let weatherFeatures = null
      let retryCount = 0

      while (!weatherFeatures && retryCount < 5) {
        try {
          // Dùng Archive API (subdomain khác, rate limit riêng biệt)
          const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${zone.centerLat}&longitude=${zone.centerLon}&start_date=${fmt(startDate)}&end_date=${fmt(endDate)}&hourly=precipitation,soil_moisture_0_to_7cm&timezone=Asia/Bangkok`
          const response = await axios.get(url, { timeout: 30000 })
          const hourlyData = response.data.hourly
          if (!hourlyData || !hourlyData.precipitation) throw new Error('Thiếu dữ liệu hourly')

          const prcpRev = [...hourlyData.precipitation].reverse()
          const soilRev = [...(hourlyData.soil_moisture_0_to_7cm || [])].reverse()

          const sumRain = (days) => {
            let s = 0
            for (let j = 0; j < Math.min(days * 24, prcpRev.length); j++) s += (prcpRev[j] || 0)
            return s
          }
          const maxRain1d = (days) => {
            let mx = 0
            for (let d = 0; d < days; d++) {
              let ds = 0
              for (let h = 0; h < 24; h++) { const idx = d * 24 + h; if (idx < prcpRev.length) ds += (prcpRev[idx] || 0) }
              if (ds > mx) mx = ds
            }
            return mx
          }
          const calcAPI = (days) => {
            let api = 0
            for (let d = days - 1; d >= 0; d--) {
              let ds = 0
              for (let h = 0; h < 24; h++) { const idx = d * 24 + h; if (idx < prcpRev.length) ds += (prcpRev[idx] || 0) }
              api = api * 0.9 + ds
            }
            return api
          }
          const avgSoil = (days) => {
            let s = 0, c = 0
            for (let j = 0; j < Math.min(days * 24, soilRev.length); j++) {
              if (soilRev[j] != null) { s += soilRev[j]; c++ }
            }
            return c > 0 ? s / c : 0
          }

          const r1 = sumRain(1), r7 = sumRain(7)
          weatherFeatures = {
            rain_1d_accum: r1, rain_3d_accum: sumRain(3),
            rain_7d_accum: r7, rain_14d_accum: sumRain(14), rain_30d_accum: sumRain(30),
            max_rain_1d_in_3d: maxRain1d(3), max_rain_1d_in_7d: maxRain1d(7),
            api_7d: calcAPI(7), api_14d: calcAPI(14),
            soil_moisture_1d: avgSoil(1), soil_moisture_7d: avgSoil(7),
            r1, r7
          }
        } catch (err) {
          retryCount++
          const waitMs = retryCount * 15000
          console.warn(`  ⚠ Lỗi lần ${retryCount}/5: ${err.message}. Đợi ${waitMs / 1000}s...`)
          await sleep(waitMs)
        }
      }

      if (!weatherFeatures) {
        console.error(`  [Bỏ qua vùng] Không lấy được data sau 5 lần thử.`)
        continue
      }

      // Apply thời tiết cho tất cả node trong vùng → Bulk Insert 500 row/lần
      const allResults = zone.nodes.map(node => ({
        node_id: node.node_id,
        rain_1d_accum: weatherFeatures.rain_1d_accum,
        rain_3d_accum: weatherFeatures.rain_3d_accum,
        rain_7d_accum: weatherFeatures.rain_7d_accum,
        rain_14d_accum: weatherFeatures.rain_14d_accum,
        rain_30d_accum: weatherFeatures.rain_30d_accum,
        max_rain_1d_in_3d: weatherFeatures.max_rain_1d_in_3d,
        max_rain_1d_in_7d: weatherFeatures.max_rain_1d_in_7d,
        api_7d: weatherFeatures.api_7d,
        api_14d: weatherFeatures.api_14d,
        soil_moisture_1d: weatherFeatures.soil_moisture_1d,
        soil_moisture_7d: weatherFeatures.soil_moisture_7d,
        slope_x_deforestation: node.slope * (1 - node.ndvi),
        twi_x_rain7d: node.twi * weatherFeatures.r7,
        rain_intensity_ratio: weatherFeatures.r1 / (weatherFeatures.r7 > 0 ? weatherFeatures.r7 : 1)
      }))

      const INSERT_CHUNK = 500
      for (let s = 0; s < allResults.length; s += INSERT_CHUNK) {
        const sub = allResults.slice(s, s + INSERT_CHUNK)
        const values = [], placeholders = []
        sub.forEach((res, idx) => {
          const o = idx * 15
          placeholders.push(`($${o+1}, NOW(), $${o+2}, $${o+3}, $${o+4}, $${o+5}, $${o+6}, $${o+7}, $${o+8}, $${o+9}, $${o+10}, $${o+11}, $${o+12}, $${o+13}, $${o+14}, $${o+15})`)
          values.push(res.node_id, res.rain_1d_accum, res.rain_3d_accum, res.rain_7d_accum, res.rain_14d_accum, res.rain_30d_accum,
            res.max_rain_1d_in_3d, res.max_rain_1d_in_7d, res.api_7d, res.api_14d,
            res.soil_moisture_1d, res.soil_moisture_7d,
            res.slope_x_deforestation, res.twi_x_rain7d, res.rain_intensity_ratio)
        })
        try {
          await pool.query(`
            INSERT INTO landslide_predictions (
              node_id, prediction_time,
              rain_1d_accum, rain_3d_accum, rain_7d_accum, rain_14d_accum, rain_30d_accum,
              max_rain_1d_in_3d, max_rain_1d_in_7d, api_7d, api_14d,
              soil_moisture_1d, soil_moisture_7d,
              slope_x_deforestation, twi_x_rain7d, rain_intensity_ratio
            ) VALUES ${placeholders.join(',')}
            ON CONFLICT DO NOTHING
          `, values)
        } catch (dbErr) {
          console.error(`  [Lỗi DB] ${dbErr.message}`)
        }
      }

      processedNodes += zone.nodes.length
      console.log(`  ✅ ${processedNodes}/${totalNodes} điểm (${(processedNodes / totalNodes * 100).toFixed(1)}%)`)
      await sleep(1000) // 1s/vùng → ~80 vùng = ~80s tổng Phase 2
    }

    console.log('🎉 Hoàn thành toàn bộ Phase 2!')
  } catch (err) {
    console.error('Lỗi nghiêm trọng trong Phase 2:', err)
  }
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────
async function main() {
  try {
    const isStaticDone = await importStaticData()
    if (isStaticDone) {
      await processDynamicData()
    }
  } catch (err) {
    console.error('Tiến trình thất bại:', err)
  } finally {
    await pool.end()
    console.log('Đã đóng kết nối CSDL.')
  }
}

main()
