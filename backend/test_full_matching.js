const fs = require('fs')
const path = require('path')
const csv = require('csv-parser')
const { Pool } = require('pg')

const connectionString = 'postgresql://h1234561:RxHwLkmC_voC-x7ZLODUbA@cosmic-kite-15897.jxf.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full'

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
})

async function checkMatch() {
  try {
    console.log('Fetching 100 sample nodes from DB...')
    const dbRes = await pool.query('SELECT node_id, lat, lon FROM landslide_grid_nodes LIMIT 100')
    const dbNodes = dbRes.rows

    console.log('Reading full CSV into a Map...')
    const csvMap = new Map()
    const csvFilePath = path.join(__dirname, 'data', 'grid_prediction_datv2.csv')

    await new Promise((resolve, reject) => {
      fs.createReadStream(csvFilePath)
        .pipe(csv())
        .on('data', (row) => {
          const lat = parseFloat(row.lat).toFixed(5)
          const lon = parseFloat(row.lon).toFixed(5)
          csvMap.set(`${lat}_${lon}`, row.province)
        })
        .on('end', resolve)
        .on('error', reject)
    })

    console.log(`CSV Map size: ${csvMap.size}`)

    console.log('Trying to match sample nodes...')
    let matched = 0
    for (const dbNode of dbNodes) {
      const key = `${dbNode.lat.toFixed(5)}_${dbNode.lon.toFixed(5)}`
      if (csvMap.has(key)) {
        matched++
      }
    }
    console.log(`Matched ${matched} out of 100 sample nodes against full CSV Map.`)
  } catch (err) {
    console.error('Error:', err)
  } finally {
    await pool.end()
  }
}

checkMatch()
