const fs = require('fs')
const path = require('path')
const csv = require('csv-parser')

async function inspect() {
  const filePath = path.join(__dirname, 'data', 'grid_prediction_datv2.csv')
  console.log('Inspecting file:', filePath)

  if (!fs.existsSync(filePath)) {
    console.error('File does not exist!')
    return
  }

  let count = 0
  const rows = []

  const stream = fs.createReadStream(filePath).pipe(csv())
  
  await new Promise((resolve, reject) => {
    stream.on('data', (row) => {
      count++
      if (count <= 5) {
        rows.push(row)
      }
      if (count > 100) {
        stream.destroy()
        resolve()
      }
    })
    .on('end', () => {
      resolve()
    })
    .on('error', (err) => {
      reject(err)
    })
  })

  console.log('Total columns:', Object.keys(rows[0] || {}))
  console.log('Sample rows:', rows)
}

inspect()
