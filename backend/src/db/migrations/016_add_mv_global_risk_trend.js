'use strict'

module.exports = {
  up: async (queryInterface) => {
    // 1. Khởi tạo Materialized View mv_global_risk_trend
    const mvSql = `
      CREATE MATERIALIZED VIEW IF NOT EXISTS mv_global_risk_trend AS
      SELECT
        date_trunc('hour', "time") AS bucket_time,
        CASE
          WHEN flood_depth_cm <= 10 THEN 'safe'
          WHEN flood_depth_cm <= 20 THEN 'medium'
          WHEN flood_depth_cm <= 40 THEN 'high'
          ELSE 'severe'
        END AS risk_level,
        COUNT(*)::int AS count
      FROM flood_predictions
      GROUP BY 1, 2;
    `
    await queryInterface.sequelize.query(mvSql)
    
    // 2. Thêm index cho mv_global_risk_trend để truy vấn cực nhanh
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_mv_global_risk_trend_time 
      ON mv_global_risk_trend (bucket_time DESC);
    `)
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query(`DROP MATERIALIZED VIEW IF EXISTS mv_global_risk_trend CASCADE;`)
  },
}
