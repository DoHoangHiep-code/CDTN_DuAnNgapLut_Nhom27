'use strict'

module.exports = {
  up: async (queryInterface) => {
    // Index 1: (flood_depth_cm) để WHERE flood_depth_cm > 10 dùng index scan
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_floodpred_depth
        ON flood_predictions (flood_depth_cm);
    `)
    console.log('[015] ✅ idx_floodpred_depth created.')

    // Index 2: (node_id, time DESC) INCLUDE — tăng tốc DISTINCT ON (node_id) ORDER BY node_id, time DESC
    // PostgreSQL 11+ hỗ trợ INCLUDE, CockroachDB/Aiven PostgreSQL cũng hỗ trợ
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_floodpred_node_time_desc
        ON flood_predictions (node_id ASC, time DESC);
    `)
    console.log('[015] ✅ idx_floodpred_node_time_desc created.')

    // Materialized View: cache prediction mới nhất mỗi node
    // Refresh sau mỗi lần Cronjob chạy (không tự động — phải REFRESH MATERIALIZED VIEW)
    // Khi đã có MV, query BBox chỉ cần JOIN mv_latest_flood_predictions (53K rows) thay vì 5.1M
    await queryInterface.sequelize.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS mv_latest_flood_predictions AS
      SELECT DISTINCT ON (node_id)
        node_id,
        risk_level,
        flood_depth_cm,
        time,
        explanation
      FROM flood_predictions
      ORDER BY node_id, time DESC;
    `)
    console.log('[015] ✅ mv_latest_flood_predictions created.')

    // Index trên MV để JOIN nhanh với grid_nodes
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_latest_fp_node_id
        ON mv_latest_flood_predictions (node_id);
    `)
    console.log('[015] ✅ idx_mv_latest_fp_node_id created.')
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query(`DROP MATERIALIZED VIEW IF EXISTS mv_latest_flood_predictions;`)
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS idx_floodpred_depth;`)
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS idx_floodpred_node_time_desc;`)
  },
}
