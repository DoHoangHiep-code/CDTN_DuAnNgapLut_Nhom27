require('dotenv').config();
const { Pool } = require('pg');
const landslideCache = require('./src/utils/landslideCache');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function test() {
  try {
    console.log("Running prewarmFromDb...");
    const result = await landslideCache.prewarmFromDb(pool);
    console.log("Result:", result);
    console.log("Stats:", landslideCache.getStats());
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    setTimeout(() => {
        pool.end();
        console.log("Pool ended");
    }, 5000);
  }
}

test();
