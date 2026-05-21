const fs = require('fs')
const path = require('path')
const csv = require('csv-parser')
const { Pool } = require('pg')
require('dotenv').config()

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

async function main() {
  console.log('=== KHỞI ĐẦU TIẾN TRÌNH REVERSE GEOCODING LANDSLIDE NODES ===')
  const startTime = Date.now()

  try {
    // 1. Đọc CSV vào map
    console.log('1. Đang đọc file CSV grid_prediction_datv2.csv vào Map...')
    const csvMap = new Map()
    const csvFilePath = path.join(__dirname, '../init-system/02_static_data/grid_prediction_datv2.csv')

    if (!fs.existsSync(csvFilePath)) {
      console.error(`Không tìm thấy file CSV tại: ${csvFilePath}`)
      return
    }

    await new Promise((resolve, reject) => {
      fs.createReadStream(csvFilePath)
        .pipe(csv())
        .on('data', (row) => {
          const lat = parseFloat(row.lat).toFixed(5)
          const lon = parseFloat(row.lon).toFixed(5)
          if (row.province) {
            csvMap.set(`${lat}_${lon}`, row.province)
          }
        })
        .on('end', resolve)
        .on('error', reject)
    })

    console.log(`Đã nạp xong ${csvMap.size} toạ độ duy nhất từ CSV.`)

    // 2. Lấy danh sách node_id, lat, lon chưa có province từ DB
    console.log('2. Đang truy vấn các nodes có province bị NULL từ database...')
    const dbNodesRes = await pool.query('SELECT node_id, lat, lon FROM landslide_grid_nodes WHERE province IS NULL')
    const dbNodes = dbNodesRes.rows
    console.log(`Tìm thấy ${dbNodes.length} nodes cần cập nhật province.`)

    if (dbNodes.length === 0) {
      console.log('Tất cả landslide nodes đã có province! Không cần cập nhật.')
      return
    }

    // 3. Phân bổ province cho từng node và chuẩn bị cập nhật theo batch
    console.log('3. Đang đối chiếu toạ độ và phân nhóm cập nhật theo batch...')
    const updates = []
    let missingMatch = 0

    for (const node of dbNodes) {
      const key = `${node.lat.toFixed(5)}_${node.lon.toFixed(5)}`
      const province = csvMap.get(key)
      if (province) {
        updates.push({ node_id: node.node_id, province })
      } else {
        missingMatch++
      }
    }

    console.log(`Đã đối chiếu thành công: ${updates.length} nodes. Bỏ qua do không khớp toạ độ: ${missingMatch} nodes.`)

    if (updates.length === 0) {
      console.log('Không có node nào được đối chiếu khớp để cập nhật.')
      return
    }

    // 4. Thực hiện batch update vào DB
    console.log('4. Bắt đầu cập nhật dữ liệu vào database...')
    const BATCH_SIZE = 2000
    const totalBatches = Math.ceil(updates.length / BATCH_SIZE)

    for (let b = 0; b < totalBatches; b++) {
      const chunk = updates.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE)
      
      // Xây dựng câu lệnh bulk update
      const values = []
      const placeholders = chunk.map((item, i) => {
        const o = i * 2
        values.push(item.node_id, item.province)
        return `($${o + 1}::uuid, $${o + 2}::text)`
      }).join(',\n')

      const query = `
        UPDATE landslide_grid_nodes AS gn
        SET province = v.province
        FROM (VALUES ${placeholders}) AS v(node_id, province)
        WHERE gn.node_id = v.node_id;
      `

      let success = false
      let retries = 3
      while (!success && retries > 0) {
        try {
          await pool.query(query, values)
          success = true
        } catch (err) {
          retries--
          console.warn(`Lỗi cập nhật batch ${b + 1}/${totalBatches}: ${err.message}. Đang thử lại (còn ${retries} lần)...`)
          if (retries === 0) {
            throw err
          }
          await new Promise(r => setTimeout(r, 1000))
        }
      }

      if ((b + 1) % 10 === 0 || b + 1 === totalBatches) {
        const pct = (((b + 1) / totalBatches) * 100).toFixed(1)
        console.log(`  Progress: ${b + 1}/${totalBatches} batches (${pct}%) | Đã cập nhật: ${(b + 1) * BATCH_SIZE > updates.length ? updates.length : (b + 1) * BATCH_SIZE} nodes...`)
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`\n🎉 HOÀN THÀNH THÀNH CÔNG! Đã cập nhật ${updates.length} nodes trong ${duration} giây.`)

  } catch (err) {
    console.error('❌ Lỗi nghiêm trọng:', err)
  } finally {
    await pool.end()
  }
}

main()
