require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function fix() {
  console.log('Đang sửa lỗi NULL trong flood_predictions bằng BATCH...');
  let updatedRows = -1;
  let totalUpdated = 0;
  
  while (updatedRows !== 0) {
    const res = await pool.query(`
      UPDATE flood_predictions
      SET target = CASE WHEN flood_depth_cm > 10 THEN 1 ELSE 0 END,
          date_only = DATE((time AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Ho_Chi_Minh')),
          month = EXTRACT(MONTH FROM (time AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Ho_Chi_Minh')),
          hour = EXTRACT(HOUR FROM (time AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Ho_Chi_Minh')),
          rainy_season_flag = (EXTRACT(MONTH FROM (time AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Ho_Chi_Minh')) BETWEEN 5 AND 10)
      WHERE prediction_id IN (
          SELECT prediction_id FROM flood_predictions WHERE date_only IS NULL LIMIT 10000
      );
    `);
    updatedRows = res.rowCount;
    totalUpdated += updatedRows;
    if (updatedRows > 0) {
      console.log(`Đã sửa ${totalUpdated} dòng...`);
    }
  }
  
  console.log('Làm mới Materialized Views...');
  try {
    await pool.query('REFRESH MATERIALIZED VIEW mv_latest_flood_predictions;');
  } catch(e) { console.error(e) }
  console.log('Hoàn thành!');
  pool.end();
}
fix().catch(console.error);
