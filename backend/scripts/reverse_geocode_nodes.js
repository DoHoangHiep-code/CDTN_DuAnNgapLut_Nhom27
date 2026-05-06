'use strict'

require('dotenv').config()
const { sequelize } = require('../src/db/sequelize')
const axios = require('axios')
const axiosRetry = require('axios-retry').default || require('axios-retry')

// Configure axios with retries for rate limit/network issues
axiosRetry(axios, {
  retries: 5,
  retryDelay: (retryCount) => {
    return retryCount * 2000 // 2s, 4s, 6s...
  },
  retryCondition: (error) => {
    return error.response?.status === 429 || axiosRetry.isNetworkOrIdempotentRequestError(error)
  }
})

const API_KEY = process.env.OPENWEATHER_API_KEY
if (!API_KEY) {
  console.error('❌ Missing OPENWEATHER_API_KEY in .env')
  process.exit(1)
}

const BATCH_SIZE = 40 // 40 requests per batch (below 50 req/s limit)
const DELAY_MS = 1000 // 1 second delay between batches

async function reverseGeocodeNodes() {
  try {
    console.log('🔍 Bắt đầu quét các nodes thiếu location_name hợp lệ...')
    // Chúng ta vừa chạy update fix_nulls gán "Grid Lat, Lon" nên ta sẽ query những node có tên bắt đầu bằng "Grid "
    const [nodes] = await sequelize.query(`
      SELECT node_id, latitude, longitude 
      FROM grid_nodes 
      WHERE location_name LIKE 'Grid %'
    `)

    console.log(`Tìm thấy ${nodes.length} điểm cần Reverse Geocoding. Bắt đầu...`)

    let successCount = 0
    let failCount = 0

    for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
      const batch = nodes.slice(i, i + BATCH_SIZE)
      const updateQueries = []

      await Promise.allSettled(
        batch.map(async (node) => {
          try {
            const url = `http://api.openweathermap.org/geo/1.0/reverse?lat=${node.latitude}&lon=${node.longitude}&limit=1&appid=${API_KEY}`
            const res = await axios.get(url)

            if (res.data && res.data.length > 0) {
              const item = res.data[0]
              // Ưu tiên Tiếng Việt > Tiếng Anh > Tên gốc
              const name = item.local_names?.vi || item.local_names?.en || item.name || 'Unknown'
              // Tạo string tên đầy đủ nếu có
              let fullName = name
              if (item.state && item.state !== name) fullName += `, ${item.state}`

              updateQueries.push(`
                UPDATE grid_nodes 
                SET location_name = '${fullName.replace(/'/g, "''")}' 
                WHERE node_id = ${node.node_id};
              `)
              successCount++
            } else {
              failCount++
            }
          } catch (err) {
            failCount++
          }
        })
      )

      if (updateQueries.length > 0) {
        await sequelize.query(updateQueries.join('\n'))
      }

      console.log(`Đã geocode thành công ${successCount}/${nodes.length} điểm (Lỗi: ${failCount})...`)

      // Delay to respect rate limit
      if (i + BATCH_SIZE < nodes.length) {
        await new Promise(r => setTimeout(r, DELAY_MS))
      }
    }

    console.log('✅ Hoàn thành Reverse Geocoding!')

  } catch (err) {
    console.error('❌ Lỗi:', err)
  } finally {
    await sequelize.close()
  }
}

reverseGeocodeNodes()
