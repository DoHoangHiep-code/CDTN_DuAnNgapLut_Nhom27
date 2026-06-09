'use strict'

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`DROP MATERIALIZED VIEW IF EXISTS mv_latest_flood_predictions CASCADE;`)
    await queryInterface.sequelize.query(`
      CREATE MATERIALIZED VIEW mv_latest_flood_predictions AS
      SELECT DISTINCT ON (node_id, date_only)
        prediction_id, node_id, time, flood_depth_cm, risk_level,
        explanation, date_only, month, hour, rainy_season_flag
      FROM flood_predictions
      WHERE time >= date_trunc('day', NOW()) - INTERVAL '1 day'
      ORDER BY node_id, date_only, flood_depth_cm DESC, ABS(EXTRACT(EPOCH FROM (time - NOW()))) ASC;
    `)
    await queryInterface.sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_latest_flood_predictions_pkey ON mv_latest_flood_predictions (prediction_id);`)
    await queryInterface.sequelize.query(`CREATE INDEX IF NOT EXISTS idx_mv_latest_fp_node_id ON mv_latest_flood_predictions (node_id);`)
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP MATERIALIZED VIEW IF EXISTS mv_latest_flood_predictions CASCADE;`)
    await queryInterface.sequelize.query(`
      CREATE MATERIALIZED VIEW mv_latest_flood_predictions AS
      SELECT DISTINCT ON (node_id, date_only)
        prediction_id, node_id, time, flood_depth_cm, risk_level,
        explanation, date_only, month, hour, rainy_season_flag
      FROM flood_predictions
      WHERE time >= date_trunc('day', NOW()) - INTERVAL '1 day'
      ORDER BY node_id, date_only, flood_depth_cm DESC, time ASC;
    `)
    await queryInterface.sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_latest_flood_predictions_pkey ON mv_latest_flood_predictions (prediction_id);`)
    await queryInterface.sequelize.query(`CREATE INDEX IF NOT EXISTS idx_mv_latest_fp_node_id ON mv_latest_flood_predictions (node_id);`)
  },
}
