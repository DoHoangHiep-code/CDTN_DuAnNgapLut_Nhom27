require('dotenv').config(); 
const {Pool} = require('pg'); 
const pool = new Pool({connectionString: process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL}); 
pool.query(`
      SELECT DISTINCT ON (trunc_time)
        date_trunc('hour', wm.time) AS trunc_time,
        wm.time,
        COALESCE(wm.prcp,   0)::float AS prcp,
        COALESCE(wm.temp,  28)::float AS temp,
        COALESCE(wm.rhum,  70)::float AS rhum,
        COALESCE(wm.clouds, 0)::int   AS clouds
      FROM weather_measurements wm
      WHERE wm.node_id = '22817'
        AND wm.time >= now() - interval '12 hours'
        AND wm.time <= now() + interval '168 hours'
      ORDER BY trunc_time ASC, wm.time DESC
      LIMIT 10;
`).then(res => console.table(res.rows)).catch(console.error).finally(()=>process.exit(0));
