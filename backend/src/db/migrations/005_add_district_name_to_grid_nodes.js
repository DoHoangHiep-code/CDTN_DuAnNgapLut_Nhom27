'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('grid_nodes', 'district_name', {
      type: Sequelize.STRING(255),
      allowNull: true,
    })
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('grid_nodes', 'district_name')
  },
}
