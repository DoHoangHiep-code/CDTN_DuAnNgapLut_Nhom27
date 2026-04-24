'use strict'

/**
 * Migration 004 – FloodPrediction: thêm cột explanation + unique constraint
 *
 * Thay đổi:
 *  1. Thêm cột TEXT `explanation` (nullable) – lưu mô tả sơ bộ từ Cronjob
 *  2. Xoá index cũ idx_floodpred_node_time (non-unique) nếu tồn tại
 *  3. Thêm UNIQUE constraint uq_floodpred_node_time (node_id, time)
 *     → Cho phép dùng INSERT ... ON CONFLICT (upsert) với bulkCreate
 */

module.exports = {
  // ── UP: áp dụng migration ─────────────────────────────────────────────────
  async up(queryInterface, Sequelize) {
    // 1. Thêm cột explanation (TEXT, nullable) vào flood_predictions
    await queryInterface.addColumn('flood_predictions', 'explanation', {
      type: Sequelize.TEXT,
      allowNull: true,
      comment: 'Mô tả sơ bộ mức độ ngập do Cronjob sinh ra',
    })

    // 2. Xoá index non-unique cũ nếu tồn tại (tránh lỗi khi chạy lại)
    //    Dùng try/catch vì index có thể chưa tồn tại tuỳ môi trường
    try {
      await queryInterface.removeIndex('flood_predictions', 'idx_floodpred_node_time')
      console.log('[Migration 004] Đã xoá index cũ idx_floodpred_node_time')
    } catch {
      console.log('[Migration 004] Index idx_floodpred_node_time không tồn tại, bỏ qua.')
    }

    // 3. Thêm UNIQUE constraint mới (node_id, time)
    //    Tên: uq_floodpred_node_time
    await queryInterface.addConstraint('flood_predictions', {
      type: 'unique',
      name: 'uq_floodpred_node_time',
      fields: ['node_id', 'time'],
    })

    console.log('[Migration 004] ✅ Đã thêm cột explanation + unique constraint uq_floodpred_node_time')
  },

  // ── DOWN: rollback migration ───────────────────────────────────────────────
  async down(queryInterface, Sequelize) {
    // Xoá unique constraint trước
    try {
      await queryInterface.removeConstraint('flood_predictions', 'uq_floodpred_node_time')
    } catch {
      console.log('[Migration 004] Không tìm thấy constraint uq_floodpred_node_time để rollback.')
    }

    // Khôi phục index non-unique cũ
    await queryInterface.addIndex('flood_predictions', {
      name: 'idx_floodpred_node_time',
      fields: ['node_id', 'time'],
      unique: false,
    })

    // Xoá cột explanation
    await queryInterface.removeColumn('flood_predictions', 'explanation')

    console.log('[Migration 004] ↩️  Đã rollback migration 004')
  },
}
