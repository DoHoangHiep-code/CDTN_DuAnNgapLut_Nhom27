const { Client } = require('pg');

async function compare() {
  const oldUrl = 'postgresql://h1234561:RxHwLkmC_voC-x7ZLODUbA@cosmic-kite-15897.jxf.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full';
  const newUrl = 'postgresql://hiep1234561:-WIbZmFLHwEH6a2CCL76CA@crab-deer-16109.jxf.gcp-asia-southeast1.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full';

  async function getStats(url, name) {
    console.log('\n--- ' + name + ' ---');
    const client = new Client({ connectionString: url });
    try {
      await client.connect();
      const res = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        ORDER BY table_name;
      `);
      for (let row of res.rows) {
        try {
          const countRes = await client.query('SELECT COUNT(*) FROM "' + row.table_name + '"');
          console.log(row.table_name.padEnd(30, ' ') + ': ' + countRes.rows[0].count);
        } catch (e) {
          console.log(row.table_name.padEnd(30, ' ') + ': ERROR - ' + e.message);
        }
      }
    } catch (e) {
      console.log('Connection failed:', e.message);
    } finally {
      await client.end();
    }
  }

  await getStats(oldUrl, 'OLD DB');
  await getStats(newUrl, 'NEW DB');
}
compare();
