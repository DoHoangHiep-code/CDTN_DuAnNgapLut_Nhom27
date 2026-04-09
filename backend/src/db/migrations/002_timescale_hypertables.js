'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // PostgreSQL 18 may not have a compatible TimescaleDB build installed.
    // To avoid blocking environments that don't ship the extension, we detect availability and skip safely.
    const rows = await queryInterface.sequelize.query(
      "SELECT 1 AS ok FROM pg_available_extensions WHERE name = 'timescaledb' LIMIT 1;",
    )
    const available = Array.isArray(rows?.[0]) ? rows[0].length > 0 : false
    if (!available) return

    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS timescaledb;')
    await queryInterface.sequelize.query("SELECT create_hypertable('weather_measurements', 'time', if_not_exists => TRUE);")
    await queryInterface.sequelize.query("SELECT create_hypertable('flood_predictions', 'time', if_not_exists => TRUE);")
  },

  async down() {
    // TimescaleDB doesn't support a simple drop-hypertable that preserves data in a reversible way.
    // Intentionally left blank.
  },
}

