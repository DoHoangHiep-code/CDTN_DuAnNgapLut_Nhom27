require('dotenv').config();
const { Pool } = require('pg');
const axios = require('axios');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
async function test() {
  const { rows } = await pool.query('SELECT node_id, lat, lon FROM landslide_grid_nodes WHERE location_name IS NULL LIMIT 5');
  for(const row of rows) {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${row.lat}&lon=${row.lon}&format=json&accept-language=vi`;
    try {
      const { data } = await axios.get(url, { headers: { 'User-Agent': 'FloodLandslideApp/1.0 (test)' } });
      const addr = data.address || {};
      const commune = addr.village || addr.suburb || addr.town || addr.hamlet || '';
      const district = addr.county || addr.city_district || addr.state_district || '';
      const province = addr.state || addr.city || addr.province || addr.region || '';
      const parts = [commune, district, province].filter(Boolean);
      console.log('Lat:', row.lat, 'Lon:', row.lon, '=>', parts.join(', '));
    } catch (e) {
      console.error(e.message);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  pool.end();
}
test();
