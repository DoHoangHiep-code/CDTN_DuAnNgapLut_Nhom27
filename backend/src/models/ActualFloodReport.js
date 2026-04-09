const { DataTypes } = require('sequelize')

module.exports = (sequelize) => {
  const ActualFloodReport = sequelize.define(
    'ActualFloodReport',
    {
      report_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
      user_id: { type: DataTypes.BIGINT, allowNull: true },
      latitude: { type: DataTypes.DECIMAL(9, 6), allowNull: false },
      longitude: { type: DataTypes.DECIMAL(9, 6), allowNull: false },
      geom: { type: DataTypes.GEOMETRY('POINT', 4326), allowNull: false },
      reported_level: { type: DataTypes.ENUM('Khô ráo', '<20cm', '>50cm'), allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: 'actual_flood_reports',
      timestamps: false,
      underscored: true,
    },
  )

  return ActualFloodReport
}

