'use strict'

/** Migration 012 – Thêm cột is_flooded vào bảng flood_predictions
 *
 * Cột này dùng để tính toán diện tích ngập nhanh chóng.
 * Nếu flood_depth_cm > 10 → is_flooded = true, ngược lại false.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    try {
      await queryInterface.addColumn('flood_predictions', 'is_flooded', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      })
      console.log('[Migration 012] ✅ Đã thêm cột is_flooded vào flood_predictions.')

      // Cập nhật dữ liệu cũ (nếu có)
      await queryInterface.sequelize.query(`
        UPDATE flood_predictions
        SET is_flooded = (flood_depth_cm > 10)
        WHERE is_flooded IS FALSE AND flood_depth_cm > 10;
      `)
      console.log('[Migration 012] ✅ Đã cập nhật is_flooded cho data cũ.')
    } catch (e) {
      if (e.message.includes('already exists')) {
        console.log('[Migration 012] Cột is_flooded đã tồn tại, bỏ qua.')
      } else throw e
    }
  },

  down: async (queryInterface) => {
    try {
      await queryInterface.removeColumn('flood_predictions', 'is_flooded')
      console.log('[Migration 012] ✅ Đã xóa cột is_flooded.')
    } catch (e) {
      if (!e.message.includes('does not exist')) throw e
    }
  },
}
