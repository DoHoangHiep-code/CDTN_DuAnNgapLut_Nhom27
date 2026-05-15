'use strict'
require('dotenv').config()

const path = require('path')
const { sequelize } = require(path.join(__dirname, 'src/db/sequelize'))

async function main() {
  await sequelize.authenticate()
  console.log('✅ Connected to DB')

  // 1. Drop location_name from weather_measurements
  await sequelize.query('ALTER TABLE weather_measurements DROP COLUMN IF EXISTS location_name;')
  console.log('✅ Dropped weather_measurements.location_name')

  // 2. Drop location_name from flood_predictions
  await sequelize.query('ALTER TABLE flood_predictions DROP COLUMN IF EXISTS location_name;')
  console.log('✅ Dropped flood_predictions.location_name')

  // 3. Add location_name to weather_stations
  await sequelize.query('ALTER TABLE weather_stations ADD COLUMN IF NOT EXISTS location_name VARCHAR(512);')
  console.log('✅ Added weather_stations.location_name')

  // 4. Add location_name to actual_flood_reports
  await sequelize.query('ALTER TABLE actual_flood_reports ADD COLUMN IF NOT EXISTS location_name VARCHAR(512);')
  console.log('✅ Added actual_flood_reports.location_name')

  // 5. Recreate MV without location_name
  await sequelize.query('DROP MATERIALIZED VIEW IF EXISTS mv_latest_flood_predictions CASCADE;')
  console.log('✅ Dropped old mv_latest_flood_predictions')

  await sequelize.query(`
    CREATE MATERIALIZED VIEW mv_latest_flood_predictions AS
    SELECT DISTINCT ON (node_id)
      prediction_id, node_id, time, flood_depth_cm, risk_level,
      explanation, date_only, month, hour, rainy_season_flag
    FROM flood_predictions
    ORDER BY node_id, time DESC;
  `)
  console.log('✅ Created new mv_latest_flood_predictions (without location_name)')

  await sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS mv_latest_flood_predictions_pkey ON mv_latest_flood_predictions (prediction_id);')
  await sequelize.query('CREATE INDEX IF NOT EXISTS idx_mv_latest_fp_node_id ON mv_latest_flood_predictions (node_id);')
  console.log('✅ MV indexes created')

  console.log('\n══════════════════════════════════════════════════════════')
  console.log('✅ Schema normalization DONE!')
  console.log('══════════════════════════════════════════════════════════\n')

  await sequelize.close()
}

main().catch(e => {
  console.error('❌', e.message)
  process.exit(1)
})
