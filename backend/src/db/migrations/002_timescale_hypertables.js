'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // PostgreSQL 18 may not have a compatible TimescaleDB build installed.
    // To avoid blocking environments that don't ship the extension, we detect availability and skip safely.
    let available = false;
    try {
      const rows = await queryInterface.sequelize.query(
        "SELECT 1 AS ok FROM pg_available_extensions WHERE name = 'timescaledb' LIMIT 1;",
      )
      available = Array.isArray(rows?.[0]) ? rows[0].length > 0 : false
    } catch (err) {
      console.warn('TimescaleDB check failed, assuming not available (likely CockroachDB)');
    }
    if (!available) return
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS timescaledb;')
    
    // TimescaleDB requires the partition column (time) to be part of any UNIQUE or PRIMARY KEY constraints.
    // Drop the default PK and recreate it including 'time'.
    await queryInterface.sequelize.query('ALTER TABLE weather_measurements DROP CONSTRAINT weather_measurements_pkey CASCADE;')
    await queryInterface.sequelize.query('ALTER TABLE weather_measurements ADD PRIMARY KEY (measurement_id, time);')
    await queryInterface.sequelize.query("SELECT create_hypertable('weather_measurements', 'time', if_not_exists => TRUE);")

    await queryInterface.sequelize.query('ALTER TABLE flood_predictions DROP CONSTRAINT flood_predictions_pkey CASCADE;')
    await queryInterface.sequelize.query('ALTER TABLE flood_predictions ADD PRIMARY KEY (prediction_id, time);')
    await queryInterface.sequelize.query("SELECT create_hypertable('flood_predictions', 'time', if_not_exists => TRUE);")
  },

  async down() {
    // TimescaleDB doesn't support a simple drop-hypertable that preserves data in a reversible way.
    // Intentionally left blank.
  },
}

