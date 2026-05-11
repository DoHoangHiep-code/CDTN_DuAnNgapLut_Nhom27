'use strict'
require('dotenv').config()
const { sequelize } = require('./src/db/sequelize')

async function main() {
  console.log('Refreshing all materialized views...')
  try {
    await sequelize.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_latest_flood_predictions;')
    console.log('✅ mv_latest_flood_predictions refreshed')
    await sequelize.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_global_risk_trend;')
    console.log('✅ mv_global_risk_trend refreshed')
    await sequelize.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_global_flood_avg;')
    console.log('✅ mv_global_flood_avg refreshed')
    console.log('\nAll MVs refreshed successfully!')
  } catch (err) {
    console.error('Error:', err.message)
    // Try without CONCURRENTLY if it fails (first time refresh)
    try {
      await sequelize.query('REFRESH MATERIALIZED VIEW mv_latest_flood_predictions;')
      await sequelize.query('REFRESH MATERIALIZED VIEW mv_global_risk_trend;')
      await sequelize.query('REFRESH MATERIALIZED VIEW mv_global_flood_avg;')
      console.log('MVs refreshed (non-concurrent)')
    } catch (e2) {
      console.error('Fatal:', e2.message)
    }
  } finally {
    await sequelize.close()
  }
}
main()
