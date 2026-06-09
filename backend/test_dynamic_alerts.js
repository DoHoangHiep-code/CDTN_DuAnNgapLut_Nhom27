require('dotenv').config();
const { Sequelize, QueryTypes } = require('sequelize');
const s = new Sequelize(process.env.DATABASE_URL, { dialectOptions: { ssl: { require: true, rejectUnauthorized: false } }, logging: false });
const sql = `
  SELECT DISTINCT ON (gn.district_name)
    gn.district_name AS district,
    fp.flood_depth_cm::float AS max_depth,
    to_char(fp.time AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM') AS time
  FROM flood_predictions fp
  JOIN grid_nodes gn ON fp.node_id = gn.node_id
  WHERE fp.time >= date_trunc('hour', now()) AND fp.time <= date_trunc('hour', now()) + interval '24 hours'
    AND (fp.target = 1 OR fp.risk_level IN ('high', 'severe', 'medium'))
    AND gn.district_name IS NOT NULL
  ORDER BY gn.district_name, fp.flood_depth_cm DESC
`;
console.log('Running query...');
const start = Date.now();
s.query(sql, { type: QueryTypes.SELECT })
  .then(r => {
    console.log(`Query took ${Date.now() - start}ms`);
    console.log(JSON.stringify(r, null, 2));
  })
  .catch(e => console.error(e))
  .finally(() => process.exit(0));
