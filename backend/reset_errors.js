require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    const { rowCount } = await pool.query("UPDATE landslide_grid_nodes SET location_name = NULL WHERE location_name = 'Lỗi API'");
    console.log(`Đã reset ${rowCount} dòng bị lỗi API về NULL.`);
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

run();
