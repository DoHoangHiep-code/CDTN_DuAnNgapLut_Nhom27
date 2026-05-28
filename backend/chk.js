require('dotenv').config(); 
const {Pool} = require('pg'); 
const pool = new Pool({connectionString: process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL}); 
pool.query("SELECT node_id, time, temp FROM weather_measurements WHERE node_id IN (1, 19688) AND time BETWEEN now() - interval '24 hours' AND now() + interval '24 hours' ORDER BY time ASC;")
  .then(res => console.table(res.rows))
  .catch(console.error)
  .finally(() => process.exit(0));
