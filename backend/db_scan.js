const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function scanDb() {
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `);
    const tables = res.rows.map(r => r.table_name);
    console.log(`Found ${tables.length} tables:`, tables);

    for (const table of tables) {
      const countRes = await client.query(`SELECT COUNT(*) FROM ${table}`);
      console.log(`Table ${table} has ${countRes.rows[0].count} records.`);
      
      // Get table structure
      const structRes = await client.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = '${table}'
      `);
      console.log(`  Columns: ${structRes.rows.map(r => r.column_name).join(', ')}`);
    }
  } catch (err) {
    console.error('Error scanning DB:', err);
  } finally {
    client.release();
    pool.end();
  }
}

scanDb();
