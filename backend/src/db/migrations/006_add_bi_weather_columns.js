'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = 'weather_measurements'

    // ── Khí tượng cơ bản (bổ sung)
    await queryInterface.sequelize.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS wdir DECIMAL(5,1);`)
    await queryInterface.sequelize.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS pressure_change_24h DECIMAL(7,3);`)

    // ── Rolling max
    await queryInterface.sequelize.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS max_prcp_3h DECIMAL(8,3);`)
    await queryInterface.sequelize.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS max_prcp_6h DECIMAL(8,3);`)
    await queryInterface.sequelize.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS max_prcp_12h DECIMAL(8,3);`)

    // ── BI Dimensional
    await queryInterface.sequelize.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS visibility_km DECIMAL(6,2);`)
    await queryInterface.sequelize.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS feels_like_c DECIMAL(5,2);`)

    // ── BI Time-Intelligence
    await queryInterface.sequelize.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS date_only DATE;`)
    await queryInterface.sequelize.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS month INTEGER;`)
    await queryInterface.sequelize.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS hour INTEGER;`)
    await queryInterface.sequelize.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS rainy_season_flag BOOLEAN;`)

    // ── De-normalize
    await queryInterface.sequelize.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS location_name VARCHAR(512);`)

    // ── Indexes cho BI
    await queryInterface.sequelize.query(`CREATE INDEX IF NOT EXISTS idx_weather_date_only ON ${table} (date_only);`)
    await queryInterface.sequelize.query(`CREATE INDEX IF NOT EXISTS idx_weather_month ON ${table} (month);`)
  },

  async down(queryInterface, Sequelize) {
    const table = 'weather_measurements'
    const cols = [
      'wdir', 'pressure_change_24h', 'max_prcp_3h', 'max_prcp_6h', 'max_prcp_12h',
      'visibility_km', 'feels_like_c', 'date_only', 'month', 'hour', 'rainy_season_flag', 'location_name'
    ]
    
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS idx_weather_date_only;`)
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS idx_weather_month;`)

    for (const col of cols) {
      await queryInterface.sequelize.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS ${col};`)
    }
  },
}
