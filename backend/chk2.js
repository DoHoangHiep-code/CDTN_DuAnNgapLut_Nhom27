require('dotenv').config(); 
const {Pool} = require('pg'); 
const pool = new Pool({connectionString: process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL}); 
async function check() {
  const nodeRes = await pool.query("SELECT node_id, weather_station_id FROM grid_nodes WHERE location_name ILIKE '%Đinh Tiên Hoàng%' LIMIT 1;");
  if (nodeRes.rows.length === 0) return console.log('not found');
  const wsId = nodeRes.rows[0].weather_station_id;
  
  const repRes = await pool.query(`SELECT DISTINCT ON (weather_station_id) node_id FROM grid_nodes WHERE weather_station_id = ${wsId} ORDER BY weather_station_id, node_id ASC;`);
  const repNodeId = repRes.rows[0].node_id;
  console.log('Target node:', repNodeId);
  
  const wRes = await pool.query(`SELECT node_id, time, temp FROM weather_measurements WHERE node_id = ${repNodeId} AND time BETWEEN now() - interval '6 hours' AND now() + interval '6 hours' ORDER BY time ASC;`);
  console.table(wRes.rows);
}
check().catch(console.error).finally(() => process.exit(0));
