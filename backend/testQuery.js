const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        console.time('queryCurrentStatusByArea_MAX');
        const res = await pool.query(`
            WITH area_nodes AS (
                SELECT node_id, location_name, latitude, longitude 
                FROM grid_nodes 
                WHERE location_name ILIKE $1
            )
            SELECT fp.node_id, fp.risk_level, fp.flood_depth_cm, fp.explanation, fp.time,
                   an.latitude, an.longitude, an.location_name
            FROM area_nodes an
            JOIN flood_predictions fp ON fp.node_id = an.node_id
            WHERE fp.time >= NOW() - INTERVAL '2 hours'
              AND fp.time = (
                  SELECT MAX(time) FROM flood_predictions WHERE node_id = an.node_id AND time >= NOW() - INTERVAL '2 hours'
              )
            ORDER BY fp.flood_depth_cm DESC
            LIMIT 10
        `, ['%Cầu Giấy%']);
        console.log('Result count:', res.rowCount);
        console.timeEnd('queryCurrentStatusByArea_MAX');
    } catch (e) {
        console.error('Err:', e.message);
    }
    pool.end();
}
run();
