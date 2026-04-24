'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // --- grid_nodes: thêm các cột khoảng cách địa lý (features tĩnh cho model) ---
    const gridCols = [
      'dist_to_drain_km',
      'dist_to_river_km',
      'dist_to_pump_km',
      'dist_to_main_road_km',
      'dist_to_park_km',
    ]
    for (const col of gridCols) {
      await queryInterface.sequelize.query(
        `ALTER TABLE grid_nodes ADD COLUMN IF NOT EXISTS ${col} DECIMAL(6,3) DEFAULT 0.5;`
      )
    }

    // --- weather_measurements: thêm cột còn thiếu cho 30 features ---
    await queryInterface.sequelize.query(
      `ALTER TABLE weather_measurements ADD COLUMN IF NOT EXISTS prcp_6h  DECIMAL DEFAULT 0;`
    )
    await queryInterface.sequelize.query(
      `ALTER TABLE weather_measurements ADD COLUMN IF NOT EXISTS prcp_12h DECIMAL DEFAULT 0;`
    )
    await queryInterface.sequelize.query(
      `ALTER TABLE weather_measurements ADD COLUMN IF NOT EXISTS pres     DECIMAL DEFAULT 1010;`
    )
  },

  async down(queryInterface) {
    for (const col of ['dist_to_drain_km','dist_to_river_km','dist_to_pump_km','dist_to_main_road_km','dist_to_park_km']) {
      await queryInterface.sequelize.query(
        `ALTER TABLE grid_nodes DROP COLUMN IF EXISTS ${col};`
      )
    }
    for (const col of ['prcp_6h','prcp_12h','pres']) {
      await queryInterface.sequelize.query(
        `ALTER TABLE weather_measurements DROP COLUMN IF EXISTS ${col};`
      )
    }
  },
}
