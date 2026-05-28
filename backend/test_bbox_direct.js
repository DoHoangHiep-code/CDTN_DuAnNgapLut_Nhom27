const { sequelize } = require('./src/db/sequelize')

async function test() {
  const minLat = 20.95, maxLat = 21.15
  const minLng = 105.75, maxLng = 105.95
  const offset = 0
  const limit = 2000

  console.time('BBoxQuery')
  const rows = await sequelize.query(
    `SELECT 
       fp.node_id, gn.latitude, gn.longitude, gn.location_name,
       MAX(fp.risk_level) as risk_level,
       MAX(fp.flood_depth_cm)::float as flood_depth_cm
     FROM grid_nodes gn
     JOIN flood_predictions fp ON fp.node_id = gn.node_id
     WHERE gn.latitude BETWEEN $1 AND $2
       AND gn.longitude BETWEEN $3 AND $4
       AND fp.date_only = CURRENT_DATE + CAST($5 || ' days' AS INTERVAL)
       AND fp.flood_depth_cm > 5
     GROUP BY fp.node_id, gn.latitude, gn.longitude, gn.location_name
     LIMIT $6`,
    {
      bind: [minLat, maxLat, minLng, maxLng, offset, limit],
      type: sequelize.QueryTypes.SELECT,
    }
  )
  console.timeEnd('BBoxQuery')
  console.log(`Found ${rows.length} rows`)
  process.exit(0)
}

test()
