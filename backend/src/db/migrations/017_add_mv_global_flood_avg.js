'use strict'

module.exports = {
  up: async (queryInterface) => {
    // Khởi tạo Materialized View mv_global_flood_avg
    const mvSql = `
      CREATE MATERIALIZED VIEW IF NOT EXISTS mv_global_flood_avg AS
      SELECT
        date_trunc('hour', "time") AS bucket_time,
        AVG(flood_depth_cm)::float AS avg_depth
      FROM flood_predictions
      GROUP BY 1;
    `
    await queryInterface.sequelize.query(mvSql)
    
    // Thêm index
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_mv_global_flood_avg_time 
      ON mv_global_flood_avg (bucket_time DESC);
    `)
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query(`DROP MATERIALIZED VIEW IF EXISTS mv_global_flood_avg CASCADE;`)
  },
}
