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

    console.log('Reading CSV rows...')
    const csvFilePath = path.join(__dirname, 'data', 'grid_prediction_datv2.csv')
    const csvNodes = []

    await new Promise((resolve, reject) => {
      fs.createReadStream(csvFilePath)
        .pipe(csv())
        .on('data', (row) => {
          csvNodes.push({
            lat: parseFloat(row.lat),
            lon: parseFloat(row.lon),
            province: row.province
          })
          if (csvNodes.length >= 1000) {
            resolve()
          }
        })
        .on('end', resolve)
        .on('error', reject)
    })

    console.log('Trying to match sample nodes...')
    let matched = 0
    for (const dbNode of dbNodes) {
      const match = csvNodes.find(c => Math.abs(c.lat - dbNode.lat) < 0.00001 && Math.abs(c.lon - dbNode.lon) < 0.00001)
      if (match) {
        matched++
      }
    }
    console.log(`Matched ${matched} out of 100 sample nodes against first 1000 CSV nodes.`)
  } catch (err) {
    console.error('Error:', err)
  } finally {
    await pool.end()
  }
}

checkMatch()
