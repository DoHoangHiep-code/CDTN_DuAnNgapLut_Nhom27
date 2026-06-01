require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const sql = `
  UPDATE landslide_predictions
  SET risk_level = 
    CASE 
      WHEN prob_landslide >= 0.26 THEN 'DANGER'
      WHEN prob_landslide >= 0.20 THEN 'WARNING'
      ELSE 'SAFE'
    END
  WHERE prediction_time >= '2026-05-31';
`;

pool.query(sql).then(res => {
  console.log(`Updated ${res.rowCount} rows`);
  pool.end();
}).catch(console.error);
