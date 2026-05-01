'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = 'flood_predictions'

    // ── BI Time-Intelligence
    await queryInterface.sequelize.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS date_only DATE;`)
    await queryInterface.sequelize.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS month INTEGER;`)
    await queryInterface.sequelize.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS hour INTEGER;`)
    await queryInterface.sequelize.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS rainy_season_flag BOOLEAN;`)

    // ── De-normalize
    await queryInterface.sequelize.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS location_name VARCHAR(512);`)

    // ── Indexes cho BI
    await queryInterface.sequelize.query(`CREATE INDEX IF NOT EXISTS idx_floodpred_date_only ON ${table} (date_only);`)
    await queryInterface.sequelize.query(`CREATE INDEX IF NOT EXISTS idx_floodpred_month ON ${table} (month);`)
    // The risk_level index was in the model but might not exist in db yet
    await queryInterface.sequelize.query(`CREATE INDEX IF NOT EXISTS idx_floodpred_risk ON ${table} (risk_level);`)
  },

  async down(queryInterface, Sequelize) {
    const table = 'flood_predictions'
    const cols = ['date_only', 'month', 'hour', 'rainy_season_flag', 'location_name']
    
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS idx_floodpred_date_only;`)
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS idx_floodpred_month;`)
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS idx_floodpred_risk;`)

    for (const col of cols) {
      await queryInterface.sequelize.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS ${col};`)
    }
  },
}
