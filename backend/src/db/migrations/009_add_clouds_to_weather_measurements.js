'use strict'

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Thêm cột clouds vào weather_measurements
    try {
      await queryInterface.addColumn('weather_measurements', 'clouds', {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      })
      console.log('[Migration] ✅ Đã thêm cột clouds vào bảng weather_measurements.')
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log('[Migration] Cột clouds đã tồn tại, bỏ qua.')
      } else {
        throw error
      }
    }
  },

  down: async (queryInterface, Sequelize) => {
    try {
      await queryInterface.removeColumn('weather_measurements', 'clouds')
      console.log('[Migration] ✅ Đã xóa cột clouds khỏi bảng weather_measurements.')
    } catch (error) {
      if (error.message.includes('does not exist')) {
        console.log('[Migration] Cột clouds không tồn tại, bỏ qua.')
      } else {
        throw error
      }
    }
  },
}
