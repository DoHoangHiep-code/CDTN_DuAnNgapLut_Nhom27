require('dotenv').config();
const { Sequelize } = require('sequelize');
const sequelize = new Sequelize(process.env.DATABASE_URL, { logging: console.log, dialectOptions: { ssl: { require: true, rejectUnauthorized: false } } });

async function run() {
  console.log('Dropping old MV...');
  await sequelize.query('DROP MATERIALIZED VIEW IF EXISTS mv_latest_flood_predictions CASCADE;');
  
  console.log('Creating new MV with MAX depth per node/day...');
  await sequelize.query(`
    CREATE MATERIALIZED VIEW mv_latest_flood_predictions AS
    SELECT DISTINCT ON (node_id, date_only)
      prediction_id, node_id, time, flood_depth_cm, risk_level,
      explanation, date_only, month, hour, rainy_season_flag
    FROM flood_predictions
    WHERE time >= date_trunc('day', NOW()) - INTERVAL '1 day'
    ORDER BY node_id, date_only, flood_depth_cm DESC, ABS(EXTRACT(EPOCH FROM (time - NOW()))) ASC;
  `);
  
  console.log('Creating indexes...');
  await sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS mv_latest_flood_predictions_pkey ON mv_latest_flood_predictions (prediction_id);');
  await sequelize.query('CREATE INDEX IF NOT EXISTS idx_mv_latest_fp_node_id ON mv_latest_flood_predictions (node_id);');
  await sequelize.query('CREATE INDEX IF NOT EXISTS idx_mv_latest_fp_date_only ON mv_latest_flood_predictions (date_only);');
  
  console.log('Verifying...');
  const { QueryTypes } = require('sequelize');
  const stats = await sequelize.query(
    "SELECT risk_level, COUNT(*) as cnt FROM mv_latest_flood_predictions WHERE date_only = CURRENT_DATE GROUP BY risk_level;",
    { type: QueryTypes.SELECT }
  );
  console.log('Risk distribution today:', stats);
  
  console.log('✅ Done!');
  process.exit(0);
}
run().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
