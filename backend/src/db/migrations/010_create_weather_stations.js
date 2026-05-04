'use strict'

/** Migration 010 – Tạo bảng weather_stations (trạm ảo lưới 3x3km)
 *
 *  Mỗi trạm ảo là tâm của một ô lưới 3km × 3km trên bản đồ Hà Nội.
 *  Bảng này được tham chiếu bởi grid_nodes (st1_id, st2_id, st3_id).
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('weather_stations', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      name: {
        type: Sequelize.STRING(128),
        allowNull: false,
      },
      latitude: {
        type: Sequelize.DECIMAL(9, 6),
        allowNull: false,
      },
      longitude: {
        type: Sequelize.DECIMAL(9, 6),
        allowNull: false,
      },
      // Số node trong ô lưới này (thống kê)
      node_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      // Ô lưới (hàng, cột) để debug/trace
      grid_row: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      grid_col: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
    })

    await queryInterface.addIndex('weather_stations', ['latitude', 'longitude'], {
      name: 'idx_weather_stations_lat_lon',
    })

    console.log('[Migration 010] ✅ Đã tạo bảng weather_stations.')
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('weather_stations')
    console.log('[Migration 010] ✅ Đã xóa bảng weather_stations.')
  },
}
