'use strict'

module.exports = {
  async up(queryInterface) {
    // Drop location_name from weather_measurements and flood_predictions
    await queryInterface.sequelize.query(`ALTER TABLE weather_measurements DROP COLUMN IF EXISTS location_name;`)
    await queryInterface.sequelize.query(`ALTER TABLE flood_predictions DROP COLUMN IF EXISTS location_name;`)

    // Add location_name to weather_stations and actual_flood_reports
    await queryInterface.sequelize.query(`ALTER TABLE weather_stations ADD COLUMN IF NOT EXISTS location_name VARCHAR(512);`)
    await queryInterface.sequelize.query(`ALTER TABLE actual_flood_reports ADD COLUMN IF NOT EXISTS location_name VARCHAR(512);`)

    // Recreate mv_latest_flood_predictions without location_name
    await queryInterface.sequelize.query(`DROP MATERIALIZED VIEW IF EXISTS mv_latest_flood_predictions CASCADE;`)
    await queryInterface.sequelize.query(`
      CREATE MATERIALIZED VIEW mv_latest_flood_predictions AS
      SELECT DISTINCT ON (node_id)
        prediction_id, node_id, time, flood_depth_cm, risk_level,
        explanation, date_only, month, hour, rainy_season_flag
      FROM flood_predictions
      ORDER BY node_id, time DESC;
    `)
    await queryInterface.sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_latest_flood_predictions_pkey ON mv_latest_flood_predictions (prediction_id);`)
    await queryInterface.sequelize.query(`CREATE INDEX IF NOT EXISTS idx_mv_latest_fp_node_id ON mv_latest_flood_predictions (node_id);`)
  },

  async down(queryInterface) {
    // Reverse: add back location_name to wm/fp, drop from ws/afr
    await queryInterface.sequelize.query(`ALTER TABLE weather_measurements ADD COLUMN IF NOT EXISTS location_name VARCHAR(512);`)
    await queryInterface.sequelize.query(`ALTER TABLE flood_predictions ADD COLUMN IF NOT EXISTS location_name VARCHAR(512);`)
    await queryInterface.sequelize.query(`ALTER TABLE weather_stations DROP COLUMN IF EXISTS location_name;`)
    await queryInterface.sequelize.query(`ALTER TABLE actual_flood_reports DROP COLUMN IF EXISTS location_name;`)
  },
}
