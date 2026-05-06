'use strict'

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Thêm cột target
    try {
      await queryInterface.addColumn('flood_predictions', 'target', {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      })
      console.log('✅ Đã thêm cột target.')
    } catch (e) {
      if (!e.message.includes('already exists')) throw e
    }

    // Copy data từ is_flooded sang target (nếu có)
    try {
      await queryInterface.sequelize.query(`
        UPDATE flood_predictions
        SET target = CASE WHEN is_flooded = true THEN 1 ELSE 0 END;
      `)
      console.log('✅ Đã copy dữ liệu sang target.')
    } catch (e) {
      console.log('Bỏ qua copy dữ liệu (có thể cột is_flooded không tồn tại).')
    }

    // Xóa cột is_flooded
    try {
      await queryInterface.removeColumn('flood_predictions', 'is_flooded')
      console.log('✅ Đã xóa cột is_flooded.')
    } catch (e) {
      if (!e.message.includes('does not exist')) throw e
    }
  },

  down: async (queryInterface, Sequelize) => {
    // Rollback
    await queryInterface.addColumn('flood_predictions', 'is_flooded', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    })
    await queryInterface.sequelize.query(`
      UPDATE flood_predictions
      SET is_flooded = (target = 1);
    `)
    await queryInterface.removeColumn('flood_predictions', 'target')
  },
}
