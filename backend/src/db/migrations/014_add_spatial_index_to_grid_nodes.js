'use strict'

module.exports = {
  up: async (queryInterface) => {
    // Thêm index cho latitude và longitude để tăng tốc độ truy vấn BBox
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_grid_nodes_lat_lng 
      ON grid_nodes (latitude, longitude);
    `)
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS idx_grid_nodes_lat_lng CASCADE;
    `)
  },
}
