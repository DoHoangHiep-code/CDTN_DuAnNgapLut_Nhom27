'use strict'

require('dotenv').config()
const { sequelize } = require('../src/db/sequelize')
const axios = require('axios')
const axiosRetry = require('axios-retry').default || require('axios-retry')

// Nominatim Policy: max 1 request/sec
axiosRetry(axios, {
  retries: 5,
  retryDelay: (retryCount) => retryCount * 2000,
  retryCondition: (error) => error.response?.status === 429 || axiosRetry.isNetworkOrIdempotentRequestError(error)
})

const USER_AGENT = process.env.GEOCODE_USER_AGENT || 'AquaAlert_Flood_Prediction_System/1.0 (admin@fpt.local)'
const DELAY_MS = 1100 // 1.1s to be safe

async function reverseGeocodeNominatim() {
  try {
    console.log('🔍 Bắt đầu Reverse Geocoding chi tiết bằng Nominatim...')
    
    // Tìm các node cần Geocode: những node có tên chung chung
    const [nodes] = await sequelize.query(`
      SELECT node_id, latitude, longitude 
      FROM grid_nodes 
      WHERE location_name LIKE 'Grid %' 
         OR location_name = 'Hà Nội' 
         OR location_name = 'Thành phố Hà Nội'
         OR location_name = 'Unknown'
         OR location_name IS NULL
      ORDER BY weather_station_id DESC NULLS LAST -- Ưu tiên các node đại diện trước
    `)

    console.log(`Tìm thấy ${nodes.length} điểm cần Reverse Geocoding. Tiến hành quét 1 req/s...`)

    let successCount = 0
    let failCount = 0

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${node.latitude}&lon=${node.longitude}&accept-language=vi`
        const res = await axios.get(url, { headers: { 'User-Agent': USER_AGENT } })

        if (res.data && res.data.address) {
          const addr = res.data.address
          // Xây dựng tên chi tiết: Số nhà/Đường, Phường/Xã, Quận/Huyện
          const street = addr.road || addr.pedestrian || addr.suburb || addr.neighbourhood || ''
          const ward = addr.quarter || addr.village || addr.hamlet || ''
          const district = addr.city_district || addr.county || addr.district || ''
          
          const parts = [street, ward, district].filter(p => p.trim() !== '')
          let detailedName = parts.join(', ')
          
          if (!detailedName) detailedName = res.data.display_name.split(',').slice(0, 2).join(', ')

          const cleanName = detailedName.replace(/'/g, "''")
          
          await sequelize.query(`
            UPDATE grid_nodes 
            SET location_name = '${cleanName}' 
            WHERE node_id = ${node.node_id};
            
            UPDATE weather_measurements
            SET location_name = '${cleanName}'
            WHERE node_id = ${node.node_id};
          `)
          successCount++
          if (i % 10 === 0) console.log(`[${i+1}/${nodes.length}] Đã cập nhật: Node ${node.node_id} -> ${detailedName}`)
        } else {
          failCount++
        }
      } catch (err) {
        failCount++
        console.error(`[Lỗi Node ${node.node_id}]`, err.message)
      }

      await new Promise(r => setTimeout(r, DELAY_MS))
    }

    console.log(`✅ Hoàn thành Reverse Geocoding! Thành công: ${successCount}, Lỗi: ${failCount}`)

  } catch (err) {
    console.error('❌ Lỗi DB:', err)
  } finally {
    await sequelize.close()
  }
}

reverseGeocodeNominatim()
