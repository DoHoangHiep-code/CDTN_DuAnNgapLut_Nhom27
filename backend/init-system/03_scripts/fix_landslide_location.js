'use strict'
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })
const { sequelize } = require('../../src/db/sequelize')
const axios = require('axios')

const SLEEP_MS = 1000 // Nominatim giới hạn 1 request / giây

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function run() {
  console.log('╔══════════════════════════════════════════════════════════════╗')
  console.log('║   AQUAALERT - Sửa lỗi NULL location_name cho Sạt Lở          ║')
  console.log('╚══════════════════════════════════════════════════════════════╝\n')

  try {
    await sequelize.authenticate()
    console.log('[DB] ✅ Kết nối CockroachDB thành công.')

    // Lấy danh sách các điểm bị NULL hoặc bị lỗi API trước đó
    const [rows] = await sequelize.query(`
      SELECT node_id, lat, lon 
      FROM landslide_grid_nodes 
      WHERE location_name IS NULL 
         OR location_name = 'Lỗi API/Không xác định'
    `)
    
    if (rows.length === 0) {
      console.log('✅ Hoàn thành! Không có điểm sạt lở nào bị thiếu location_name.')
      return
    }

    console.log(`[Geocoding] Tìm thấy ${rows.length} điểm bị thiếu tên. Bắt đầu dịch toạ độ...`)

    let count = 0
    for (const row of rows) {
      try {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${row.lat}&lon=${row.lon}&format=json&accept-language=vi`
        
        const response = await axios.get(url, {
          headers: {
            'User-Agent': 'VietFloodPredictionApp/1.0',
            'Accept-Language': 'vi'
          }
        })

        const address = response.data?.address || {}
        
        // Trích xuất: Xã/Phường, Huyện/Quận, Tỉnh/Thành phố
        const commune = address.village || address.suburb || address.town || address.hamlet || ''
        const district = address.county || address.city_district || address.state_district || ''
        const province = address.state || address.city || address.province || address.region || ''

        const parts = [commune, district, province].filter(Boolean)
        const locationName = parts.length > 0 ? parts.join(', ') : 'Vùng núi hẻo lánh'

        await sequelize.query(
          'UPDATE landslide_grid_nodes SET location_name = :loc WHERE node_id = :id',
          { replacements: { loc: locationName, id: row.node_id } }
        )

        count++
        process.stdout.write(`\rĐã xử lý: ${count}/${rows.length} điểm`)

        await sleep(SLEEP_MS) // Tránh bị chặn bởi Nominatim
      } catch (err) {
        console.error(`\n[Lỗi node ${row.node_id}]`, err.message)
        // Nếu lỗi, đánh dấu tạm để bỏ qua
        await sequelize.query(
          'UPDATE landslide_grid_nodes SET location_name = :loc WHERE node_id = :id',
          { replacements: { loc: 'Lỗi API/Không xác định', id: row.node_id } }
        )
        await sleep(SLEEP_MS)
      }
    }
    
    console.log('\n[Geocoding] ✅ Đã vá xong toàn bộ các điểm bị thiếu tên!')

  } catch (err) {
    console.error('\n[Lỗi Hệ Thống]', err)
  } finally {
    await sequelize.close()
    process.exit(0)
  }
}

run()
