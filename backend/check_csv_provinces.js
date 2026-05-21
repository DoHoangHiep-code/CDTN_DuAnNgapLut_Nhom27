const fs = require('fs')
const path = require('path')
const csv = require('csv-parser')

async function checkCsvProvinces() {
  const csvFilePath = path.join(__dirname, 'data', 'grid_prediction_datv2.csv')
  if (!fs.existsSync(csvFilePath)) {
    console.error('CSV not found')
    return
  }

  let total = 0
  let emptyProvince = 0
  const uniqueProvinces = new Set()

  return new Promise((resolve, reject) => {
    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on('data', (row) => {
        total++
        const p = row.province
        if (!p || p.trim() === '') {
          emptyProvince++
        } else {
          uniqueProvinces.add(p)
        }
      })
      .on('end', () => {
        console.log('CSV Stats:')
        console.log('Total rows:', total)
        console.log('Empty provinces:', emptyProvince)
        console.log('Unique provinces:', Array.from(uniqueProvinces))
        resolve()
      })
      .on('error', reject)
  })
}

checkCsvProvinces()
