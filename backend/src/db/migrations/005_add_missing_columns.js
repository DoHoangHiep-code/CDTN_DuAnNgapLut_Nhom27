'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query('ALTER TABLE grid_nodes ADD COLUMN IF NOT EXISTS location_name VARCHAR(512);')
    await queryInterface.sequelize.query('ALTER TABLE grid_nodes ADD COLUMN IF NOT EXISTS grid_id VARCHAR(64);')
    await queryInterface.sequelize.query('ALTER TABLE grid_nodes ADD COLUMN IF NOT EXISTS weather_station_id INTEGER;')
    await queryInterface.sequelize.query('ALTER TABLE grid_nodes ADD CONSTRAINT uq_grid_lat_lon UNIQUE (latitude, longitude);')
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('ALTER TABLE grid_nodes DROP CONSTRAINT IF EXISTS uq_grid_lat_lon;')
    await queryInterface.sequelize.query('ALTER TABLE grid_nodes DROP COLUMN IF EXISTS weather_station_id;')
    await queryInterface.sequelize.query('ALTER TABLE grid_nodes DROP COLUMN IF EXISTS grid_id;')
    await queryInterface.sequelize.query('ALTER TABLE grid_nodes DROP COLUMN IF EXISTS location_name;')
  },
}
