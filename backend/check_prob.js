require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const sql = `
  SELECT 
    MIN(prob_landslide) as min_prob,
    AVG(prob_landslide) as avg_prob,
    MAX(prob_landslide) as max_prob,
    percentile_cont(0.5) within group (order by prob_landslide) as median_prob,
    percentile_cont(0.75) within group (order by prob_landslide) as p75_prob,
    percentile_cont(0.90) within group (order by prob_landslide) as p90_prob,
    percentile_cont(0.95) within group (order by prob_landslide) as p95_prob,
    percentile_cont(0.99) within group (order by prob_landslide) as p99_prob,
    COUNT(*) as total
  FROM landslide_predictions
  WHERE prediction_time >= '2026-05-31' AND prediction_time < '2026-06-01';
`;

pool.query(sql).then(res => {
  console.log(res.rows);
  pool.end();
}).catch(console.error);
