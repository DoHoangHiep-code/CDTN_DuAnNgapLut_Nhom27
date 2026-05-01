'use strict'

/**
 * scripts/seed_hotspots.js
 *
 * Geocode 39 điểm ngập thực tế Hà Nội qua Nominatim (OpenStreetMap) và upsert
 * vào bảng grid_nodes.
 *
 * Chạy:
 *   node scripts/seed_hotspots.js
 *
 * Yêu cầu:
 *   - File .env phải có DATABASE_URL_POOLER
 *   - Module axios đã được cài (có sẵn trong package.json)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })

const axios = require('axios')
const { sequelize } = require('../src/db/sequelize')

// Nạp toàn bộ models (bao gồm GridNode với cột location_name mới)
require('../src/models')
const { GridNode } = require('../src/models')

// ─── Danh sách 39 điểm ngập Hà Nội ──────────────────────────────────────────

const HOTSPOTS = [
  'Ngã tư Phan Bội Châu - Lý Thường Kiệt, Hoàn Kiếm, Hà Nội',
  'Ngã tư Tây Sơn - Thái Hà, Đống Đa, Hà Nội',
  'Phố Hoa Bằng, Cầu Giấy, Hà Nội',
  'Nguyễn Khuyến, Đống Đa, Hà Nội',
  'Thụy Khuê - Dốc La Pho, Tây Hồ, Hà Nội',
  'Minh Khai - cầu Vĩnh Tuy, Hà Nội',
  'Ngã ba Giải Phóng - Bến xe Giáp Bát, Hà Nội',
  'Phố Nguyễn Chính, Hoàng Mai, Hà Nội',
  'Phố Thanh Đàm, Hoàng Mai, Hà Nội',
  'Trường Chinh, Bệnh viện PKKQ, Hà Nội',
  'Phạm Văn Đồng, Cầu 7, Bắc Từ Liêm, Hà Nội',
  'Ngã 3 Xuân Đỉnh - Tân Xuân, Bắc Từ Liêm, Hà Nội',
  'Ngọc Lâm - Long Biên 1, Long Biên, Hà Nội',
  'Phố Hoàng Như Tiếp, Long Biên, Hà Nội',
  'Đại lộ Thăng Long - Lê Trọng Tấn, Hà Nội',
  'Đỗ Đức Dục - Miếu Đầm, Hà Nội',
  'Phùng Khoang, Nam Từ Liêm, Hà Nội',
  'Ngõ 42 Triều Khúc, Thanh Trì, Hà Nội',
  'Ngã ba Nguyễn Trãi - Nguyễn Xiển, Hà Nội',
  'Ngã ba Vũ Trọng Phụng - Quan Nhân, Hà Nội',
  'Bùi Xương Trạch, Thanh Xuân, Hà Nội',
  'Phố Cự Lộc, Thanh Xuân, Hà Nội',
  'Vương Thừa Vũ, Thanh Xuân, Hà Nội',
  'Phan Văn Trường, Cầu Giấy, Hà Nội',
  'Trần Bình - Bệnh viện 19/8, Hà Nội',
  'Ngã năm Bà Triệu, Hà Nội',
  'Ngã tư Liên Trì - Nguyễn Gia Thiều, Hà Nội',
  'Phố Tông Đản, Hà Nội',
  'Cao Bá Quát - Công ty MTĐT, Ba Đình, Hà Nội',
  'Điện Biên Phủ - Nguyễn Tri Phương, Hà Nội',
  'Phùng Hưng - Bát Đàn, Hà Nội',
  'Đội Cấn - Chùa Bát Tháp, Ba Đình, Hà Nội',
  'Khu đô thị RESCO, Bắc Từ Liêm, Hà Nội',
  'Võ Chí Công - UDIC, Tây Hồ, Hà Nội',
  'Quang Trung - Lê Trọng Tấn, Hà Đông, Hà Nội',
  'Đường Cổ Linh - Aeon Mall, Long Biên, Hà Nội',
  'Phố Kẻ Vẽ, Bắc Từ Liêm, Hà Nội',
  'Quốc lộ 3, xã Mai Lâm, Đông Anh, Hà Nội',
  'Đường 23B, thôn Cổ Điển, Đông Anh, Hà Nội',
]

// Tọa độ fallback thủ công (nếu Nominatim không tìm được)
// Được dùng khi API trả về 0 kết quả cho 1 địa điểm cụ thể
const FALLBACK_COORDS = {
  'Ngã tư Phan Bội Châu - Lý Thường Kiệt, Hoàn Kiếm, Hà Nội':       { lat: 21.0265, lon: 105.8432 },
  'Ngã tư Tây Sơn - Thái Hà, Đống Đa, Hà Nội':                        { lat: 21.0118, lon: 105.8201 },
  'Phố Hoa Bằng, Cầu Giấy, Hà Nội':                                   { lat: 21.0312, lon: 105.7985 },
  'Nguyễn Khuyến, Đống Đa, Hà Nội':                                   { lat: 21.0298, lon: 105.8385 },
  'Thụy Khuê - Dốc La Pho, Tây Hồ, Hà Nội':                          { lat: 21.0428, lon: 105.8285 },
  'Minh Khai - cầu Vĩnh Tuy, Hà Nội':                                 { lat: 20.9997, lon: 105.8675 },
  'Ngã ba Giải Phóng - Bến xe Giáp Bát, Hà Nội':                     { lat: 20.9845, lon: 105.8423 },
  'Phố Nguyễn Chính, Hoàng Mai, Hà Nội':                              { lat: 20.9782, lon: 105.8565 },
  'Phố Thanh Đàm, Hoàng Mai, Hà Nội':                                 { lat: 20.9625, lon: 105.8412 },
  'Trường Chinh, Bệnh viện PKKQ, Hà Nội':                             { lat: 21.0052, lon: 105.8102 },
  'Phạm Văn Đồng, Cầu 7, Bắc Từ Liêm, Hà Nội':                      { lat: 21.0555, lon: 105.7825 },
  'Ngã 3 Xuân Đỉnh - Tân Xuân, Bắc Từ Liêm, Hà Nội':                { lat: 21.0618, lon: 105.7952 },
  'Ngọc Lâm - Long Biên 1, Long Biên, Hà Nội':                        { lat: 21.0445, lon: 105.8755 },
  'Phố Hoàng Như Tiếp, Long Biên, Hà Nội':                            { lat: 21.0538, lon: 105.8912 },
  'Đại lộ Thăng Long - Lê Trọng Tấn, Hà Nội':                        { lat: 21.0025, lon: 105.7465 },
  'Đỗ Đức Dục - Miếu Đầm, Hà Nội':                                   { lat: 21.0098, lon: 105.7745 },
  'Phùng Khoang, Nam Từ Liêm, Hà Nội':                                { lat: 20.9912, lon: 105.7952 },
  'Ngõ 42 Triều Khúc, Thanh Trì, Hà Nội':                            { lat: 20.9785, lon: 105.7958 },
  'Ngã ba Nguyễn Trãi - Nguyễn Xiển, Hà Nội':                        { lat: 20.9952, lon: 105.8115 },
  'Ngã ba Vũ Trọng Phụng - Quan Nhân, Hà Nội':                       { lat: 21.0005, lon: 105.8195 },
  'Bùi Xương Trạch, Thanh Xuân, Hà Nội':                              { lat: 20.9965, lon: 105.8268 },
  'Phố Cự Lộc, Thanh Xuân, Hà Nội':                                   { lat: 21.0018, lon: 105.8098 },
  'Vương Thừa Vũ, Thanh Xuân, Hà Nội':                                { lat: 21.0032, lon: 105.8155 },
  'Phan Văn Trường, Cầu Giấy, Hà Nội':                                { lat: 21.0368, lon: 105.7998 },
  'Trần Bình - Bệnh viện 19/8, Hà Nội':                               { lat: 21.0328, lon: 105.7808 },
  'Ngã năm Bà Triệu, Hà Nội':                                         { lat: 21.0265, lon: 105.8508 },
  'Ngã tư Liên Trì - Nguyễn Gia Thiều, Hà Nội':                      { lat: 21.0285, lon: 105.8535 },
  'Phố Tông Đản, Hà Nội':                                             { lat: 21.0312, lon: 105.8558 },
  'Cao Bá Quát - Công ty MTĐT, Ba Đình, Hà Nội':                     { lat: 21.0332, lon: 105.8388 },
  'Điện Biên Phủ - Nguyễn Tri Phương, Hà Nội':                       { lat: 21.0362, lon: 105.8412 },
  'Phùng Hưng - Bát Đàn, Hà Nội':                                     { lat: 21.0348, lon: 105.8448 },
  'Đội Cấn - Chùa Bát Tháp, Ba Đình, Hà Nội':                        { lat: 21.0355, lon: 105.8308 },
  'Khu đô thị RESCO, Bắc Từ Liêm, Hà Nội':                           { lat: 21.0728, lon: 105.7678 },
  'Võ Chí Công - UDIC, Tây Hồ, Hà Nội':                              { lat: 21.0578, lon: 105.8128 },
  'Quang Trung - Lê Trọng Tấn, Hà Đông, Hà Nội':                     { lat: 20.9762, lon: 105.7698 },
  'Đường Cổ Linh - Aeon Mall, Long Biên, Hà Nội':                     { lat: 21.0412, lon: 105.9012 },
  'Phố Kẻ Vẽ, Bắc Từ Liêm, Hà Nội':                                  { lat: 21.0758, lon: 105.8082 },
  'Quốc lộ 3, xã Mai Lâm, Đông Anh, Hà Nội':                         { lat: 21.1255, lon: 105.8825 },
  'Đường 23B, thôn Cổ Điển, Đông Anh, Hà Nội':                       { lat: 21.1412, lon: 105.8678 },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Delay ms để không bị Nominatim block IP (policy: >= 1 req/s) */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Geocode 1 địa chỉ qua Nominatim.
 * @param {string} address
 * @returns {Promise<{lat: number, lon: number}|null>}
 */
async function geocode(address) {
  try {
    const resp = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: {
        q:              address,
        format:         'json',
        limit:          1,
        countrycodes:   'vn',
      },
      headers: {
        // Nominatim yêu cầu User-Agent hợp lệ để không bị rate-limit / ban
        'User-Agent': 'AQUAALERT-FloodSeed/1.0 (flood-prediction-hanoi)',
        'Accept-Language': 'vi,en',
      },
      timeout: 10000,
    })

    const results = resp.data
    if (!results || results.length === 0) return null

    return { lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon) }
  } catch (err) {
    console.error(`  [Geocode] Lỗi khi geocode "${address}":`, err.message)
    return null
  }
}

/**
 * Tạo GeoJSON Point từ lat/lon cho PostGIS
 */
function makePoint(lon, lat) {
  return { type: 'Point', coordinates: [lon, lat] }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║   AQUAALERT – Seed 39 Điểm Ngập Hà Nội vào grid_nodes   ║')
  console.log('╚══════════════════════════════════════════════════════════╝\n')

  try {
    await sequelize.authenticate()
    console.log('[DB] ✅ Kết nối Aiven thành công.\n')
  } catch (err) {
    console.error('[DB] ❌ Không kết nối được Aiven:', err.message)
    process.exit(1)
  }

  // Sync schema (alter:true) để cột location_name được tạo trên Aiven
  try {
    // await sequelize.sync({ alter: true })
    console.log('[DB] ✅ Schema đã sync (alter:true) (skipped).\n')
  } catch (err) {
    console.error('[DB] ⚠ Sync warning (thường bỏ qua được):', err.message)
  }

  const results = []
  let geocodeHit   = 0
  let fallbackHit  = 0
  let skipCount    = 0

  for (let i = 0; i < HOTSPOTS.length; i++) {
    const name = HOTSPOTS[i]
    const idx  = i + 1
    process.stdout.write(`[${idx.toString().padStart(2, '0')}/39] Geocoding: ${name.slice(0, 60)}… `)

    // 1) Thử Nominatim
    let coord = await geocode(name)

    if (coord) {
      geocodeHit++
      console.log(`✅  lat=${coord.lat.toFixed(6)}, lon=${coord.lon.toFixed(6)}`)
    } else {
      // 2) Fallback tọa độ thủ công
      coord = FALLBACK_COORDS[name] || null
      if (coord) {
        fallbackHit++
        console.log(`⚠  Nominatim miss → dùng fallback  lat=${coord.lat.toFixed(6)}, lon=${coord.lon.toFixed(6)}`)
      } else {
        skipCount++
        console.log('❌  Bỏ qua (không có tọa độ)')
        continue
      }
    }

    results.push({
      // node_id bắt đầu từ 200001 để tránh trùng với các node hiện có (100000-series)
      node_id:          200000 + idx,
      latitude:         coord.lat,
      longitude:        coord.lon,
      elevation:        5.0,          // Giá trị trung bình Hà Nội (m)
      slope:            1.5,          // Độ dốc trung bình (%)
      impervious_ratio: 0.65,         // Tỷ lệ không thấm nước đặc trưng đô thị
      geom:             makePoint(coord.lon, coord.lat),
      location_name:    name,
      // Khoảng cách trung bình cho khu vực đô thị Hà Nội
      dist_to_drain_km:     0.3,
      dist_to_river_km:     1.2,
      dist_to_pump_km:      0.8,
      dist_to_main_road_km: 0.1,
      dist_to_park_km:      0.5,
    })

    // Delay 1.2s giữa mỗi request (Nominatim policy: max 1 req/s + buffer)
    if (i < HOTSPOTS.length - 1) await sleep(1200)
  }

  if (!results.length) {
    console.error('\n[Seed] ❌ Không có bản ghi nào để upsert. Kiểm tra kết nối mạng.')
    process.exit(1)
  }

  console.log(`\n[Seed] Geocoding xong: ${geocodeHit} từ Nominatim, ${fallbackHit} từ fallback, ${skipCount} bỏ qua.`)
  console.log(`[Seed] Bắt đầu upsert ${results.length} bản ghi vào grid_nodes…`)

  try {
    // Upsert: nếu node_id đã tồn tại → cập nhật tọa độ + location_name
    await GridNode.bulkCreate(results, {
      updateOnDuplicate: [
        'latitude', 'longitude', 'geom',
        'location_name',
        'elevation', 'slope', 'impervious_ratio',
        'dist_to_drain_km', 'dist_to_river_km', 'dist_to_pump_km',
        'dist_to_main_road_km', 'dist_to_park_km',
      ],
    })

    console.log(`\n✅ THÀNH CÔNG! Đã upsert ${results.length} GridNode vào Aiven.`)
    console.log('   Bảng grid_nodes đã được điền đầy đủ 39 điểm ngập thực tế Hà Nội.')
    console.log('\n📌 Bước tiếp theo:')
    console.log('   1. Mở Aiven Dashboard → Table Editor → grid_nodes để kiểm tra.')
    console.log('   2. Chạy cronjob để lấy dữ liệu thời tiết cho các node mới:')
    console.log('      curl http://localhost:3002/api/v1/cron/trigger')
  } catch (err) {
    console.error('\n[Seed] ❌ Lỗi upsert vào DB:', err.message)
    if (err.original) console.error('  SQL error:', err.original.message)
    process.exit(1)
  } finally {
    await sequelize.close()
    console.log('\n[DB] Đã đóng kết nối.')
  }
}

main()
