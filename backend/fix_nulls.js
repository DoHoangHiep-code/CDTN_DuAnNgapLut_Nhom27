const { sequelize } = require('./src/db/sequelize')

async function fixNulls() {
  try {
    // 1. Cập nhật location_name (tránh lỗi font, gán Grid_Lat_Lon)
    await sequelize.query(`
      UPDATE grid_nodes 
      SET location_name = 'Grid ' || ROUND(latitude::numeric, 4) || ', ' || ROUND(longitude::numeric, 4)
      WHERE location_name IS NULL
    `)
    console.log('✅ Updated location_name for 53k nodes.')

    // 2. Cập nhật district_name
    await sequelize.query(`
      UPDATE grid_nodes 
      SET district_name = 'Hà Nội' 
      WHERE district_name IS NULL
    `)
    console.log('✅ Updated district_name.')

    // 3. Cập nhật grid_id cho các hotspot cũ
    await sequelize.query(`
      UPDATE grid_nodes 
      SET grid_id = 'Hotspot_' || node_id 
      WHERE grid_id IS NULL
    `)
    console.log('✅ Updated grid_id.')

    // 4. Update weather_measurements location_name (mặc dù ko cần thiết do lấy từ grid_nodes, nhưng cứ update cho đồng bộ)
    await sequelize.query(`
      UPDATE weather_measurements w
      SET location_name = g.location_name
      FROM grid_nodes g
      WHERE w.node_id = g.node_id AND w.location_name IS NULL
    `)
    console.log('✅ Updated weather_measurements location_name.')

  } catch (err) {
    console.error('Lỗi:', err.message)
  } finally {
    await sequelize.close()
  }
}

fixNulls()
