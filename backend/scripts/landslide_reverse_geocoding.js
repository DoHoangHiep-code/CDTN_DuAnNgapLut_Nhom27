'use strict'

require('dotenv').config()
const { Pool } = require('pg')
const axios = require('axios')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

const BATCH_SIZE = 500
const SLEEP_MS = 1000

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function run() {
  console.log('[Landslide Reverse Geocoding] Starting script...')
  let processedCount = 0

  while (true) {
    const { rows } = await pool.query(
      'SELECT node_id, lat, lon FROM landslide_grid_nodes WHERE location_name IS NULL LIMIT $1',
      [BATCH_SIZE]
    )

    if (rows.length === 0) {
      console.log('✅ Hoàn thành! Không còn điểm nào thiếu location_name.')
      break
    }

    console.log(`Tiến hành xử lý lô ${rows.length} điểm...`)

    for (const row of rows) {
      try {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${row.lat}&lon=${row.lon}&format=json&accept-language=vi`
        
        // Cần truyền User-Agent để không bị Nominatim chặn
        const response = await axios.get(url, {
          headers: {
            'User-Agent': 'VietFloodPredictionApp_UniversityProject/1.0 (test_vietnam@gmail.com)',
            'Accept-Language': 'vi'
          }
        })

        const address = response.data?.address || {}
        
        // Trích xuất: Xã/Phường, Huyện/Quận, Tỉnh/Thành phố
        const commune = address.village || address.suburb || address.town || address.hamlet || ''
        const district = address.county || address.city_district || address.state_district || ''
        const province = address.state || address.city || address.province || address.region || ''

        // Format thành chuỗi: "Xã, Huyện, Tỉnh"
        const parts = [commune, district, province].filter(Boolean)
        const locationName = parts.length > 0 ? parts.join(', ') : 'Không xác định'

        await pool.query(
          'UPDATE landslide_grid_nodes SET location_name = $1 WHERE node_id = $2',
          [locationName, row.node_id]
        )

        processedCount++
        if (processedCount % 10 === 0) {
          console.log(`Đã cập nhật vị trí cho ${processedCount} điểm...`)
        }

        // Tôn trọng giới hạn của Nominatim (1 req/s)
        await sleep(SLEEP_MS)

      } catch (err) {
        console.error(`[Lỗi node_id ${row.node_id}]`, err.message)
        // Dù lỗi API cũng đánh dấu tạm thời để không bị lặp vô tận (nếu lỗi liên tục)
        await pool.query(
          'UPDATE landslide_grid_nodes SET location_name = $1 WHERE node_id = $2',
          ['Lỗi API', row.node_id]
        )
        await sleep(SLEEP_MS)
      }
    }
    
    console.log(`Đã hoàn thành lô. Tổng cập nhật: ${processedCount}`)
    // Để đảm bảo không chạy mãi mãi trong lúc test, script này sẽ tiếp tục loop 
    // vì chúng ta đang xử lý LIMIT 500, nhưng bạn có thể cancel (Ctrl+C).
  }

  pool.end()
}

run().catch(err => {
  console.error('[Fatal Error]', err)
  pool.end()
})
