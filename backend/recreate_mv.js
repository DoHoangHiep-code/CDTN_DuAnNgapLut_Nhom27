const {sequelize} = require('./src/db/sequelize');
async function run() {
  try {
    await sequelize.query('DROP MATERIALIZED VIEW IF EXISTS mv_latest_flood_predictions CASCADE;');
    await sequelize.query(`
      CREATE MATERIALIZED VIEW mv_latest_flood_predictions AS
      SELECT DISTINCT ON (node_id)
        prediction_id, node_id, time, flood_depth_cm, risk_level,
        explanation, date_only, month, hour, rainy_season_flag
      FROM flood_predictions
      WHERE time >= NOW() - INTERVAL '6 hours'
      ORDER BY node_id, time ASC;
    `);
    await sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS mv_latest_flood_predictions_pkey ON mv_latest_flood_predictions (prediction_id);');
    await sequelize.query('CREATE INDEX IF NOT EXISTS idx_mv_latest_fp_node_id ON mv_latest_flood_predictions (node_id);');
    console.log('Recreated MV');
  } catch(e) {
    console.error(e);
  } finally {
    process.exit();
  }
}
run();
