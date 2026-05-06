'use strict'

/** Migration 011 – Thêm 7 cột IDW vào bảng grid_nodes
 *
 *  st1_id / st1_weight  – Trạm ảo gần nhất + trọng số IDW (1/d²)
 *  st2_id / st2_weight  – Trạm ảo gần thứ 2 + trọng số IDW
 *  st3_id / st3_weight  – Trạm ảo gần thứ 3 + trọng số IDW
 *  is_out_of_bounds     – true nếu trạm gần nhất cách xa > 15km (vùng mù)
 *
 *  Giá trị trọng số IDW: w_i = 1 / (d_i²), đã chuẩn hóa sao cho tổng = 1.
 *  Được tính 1 lần bởi script calculate_idw_weights.js (chạy offline).
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const cols = [
      ['st1_id',     Sequelize.FLOAT],
      ['st1_weight', Sequelize.FLOAT],
      ['st2_id',     Sequelize.FLOAT],
      ['st2_weight', Sequelize.FLOAT],
      ['st3_id',     Sequelize.FLOAT],
      ['st3_weight', Sequelize.FLOAT],
    ]

    for (const [col, type] of cols) {
      try {
        await queryInterface.addColumn('grid_nodes', col, {
          type,
          allowNull: true,
          defaultValue: null,
        })
      } catch (e) {
        if (e.message.includes('already exists')) {
          console.log(`[Migration 011] Cột ${col} đã tồn tại, bỏ qua.`)
        } else throw e
      }
    }

    try {
      await queryInterface.addColumn('grid_nodes', 'is_out_of_bounds', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      })
    } catch (e) {
      if (e.message.includes('already exists')) {
        console.log('[Migration 011] Cột is_out_of_bounds đã tồn tại, bỏ qua.')
      } else throw e
    }

    console.log('[Migration 011] ✅ Đã thêm 7 cột IDW vào grid_nodes.')
  },

  down: async (queryInterface) => {
    const cols = ['st1_id', 'st1_weight', 'st2_id', 'st2_weight', 'st3_id', 'st3_weight', 'is_out_of_bounds']
    for (const col of cols) {
      try {
        await queryInterface.removeColumn('grid_nodes', col)
      } catch (e) {
        if (!e.message.includes('does not exist')) throw e
      }
    }
    console.log('[Migration 011] ✅ Đã xóa 7 cột IDW khỏi grid_nodes.')
  },
}
