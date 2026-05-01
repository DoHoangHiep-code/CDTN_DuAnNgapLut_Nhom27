'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Add unique constraints to time-series tables so that ON CONFLICT (node_id, time) works.
    try {
      await queryInterface.sequelize.query(`
        ALTER TABLE weather_measurements
        ADD CONSTRAINT uq_weather_node_time UNIQUE (node_id, time);
      `)
    } catch (e) {
      console.log('weather_measurements constraint might already exist:', e.message)
    }

    try {
      await queryInterface.sequelize.query(`
        ALTER TABLE flood_predictions
        ADD CONSTRAINT uq_floodpred_node_time UNIQUE (node_id, time);
      `)
    } catch (e) {
      console.log('flood_predictions constraint might already exist:', e.message)
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE weather_measurements
      DROP CONSTRAINT IF EXISTS uq_weather_node_time;
    `)

    await queryInterface.sequelize.query(`
      ALTER TABLE flood_predictions
      DROP CONSTRAINT IF EXISTS uq_floodpred_node_time;
    `)
  },
}
