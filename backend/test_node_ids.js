require('dotenv').config()
const { sequelize } = require('./src/db/sequelize')
const { QueryTypes } = require('sequelize')

const search = 'Cầu Nhật Tân (Làn xe máy), Phường Hồng Hà, Xã Vĩnh Thanh'

;(async () => {
  console.log('Search term:', JSON.stringify(search))
  console.log('Pattern literal:', search.trim())

  // Kiểm tra exact match
  const exact = await sequelize.query(
    `SELECT COUNT(*) as cnt FROM grid_nodes WHERE location_name = $1`,
    { type: QueryTypes.SELECT, bind: [search.trim()] }
  )
  console.log('Exact match count (using $1 bind):', exact[0])

  // Kiểm tra với named replacement
  const named = await sequelize.query(
    `SELECT COUNT(*) as cnt FROM grid_nodes WHERE location_name = :pattern`,
    { type: QueryTypes.SELECT, replacements: { pattern: search.trim() } }
  )
  console.log('Exact match count (using :pattern):', named[0])

  // Kiểm tra ILIKE
  const ilike = await sequelize.query(
    `SELECT COUNT(*) as cnt FROM grid_nodes WHERE location_name ILIKE :pattern`,
    { type: QueryTypes.SELECT, replacements: { pattern: `%Cầu Nhật Tân%` } }
  )
  console.log('ILIKE Cầu Nhật Tân count:', ilike[0])

  // Sample location names từ DB
  const sample = await sequelize.query(
    `SELECT DISTINCT location_name FROM grid_nodes WHERE location_name ILIKE '%Nh%t T%n%' LIMIT 5`,
    { type: QueryTypes.SELECT }
  )
  console.log('Sample names from DB:', sample.map(r => r.location_name))
})()
  .catch(e => console.error(e.message))
  .finally(() => sequelize.close())
