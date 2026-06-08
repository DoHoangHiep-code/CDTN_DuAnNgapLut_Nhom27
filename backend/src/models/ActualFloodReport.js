const { DataTypes } = require('sequelize')

module.exports = (sequelize) => {
  const ActualFloodReport = sequelize.define(
    'ActualFloodReport',
    {
      report_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
      user_id: { type: DataTypes.BIGINT, allowNull: true },
      latitude: { type: DataTypes.DECIMAL(9, 6), allowNull: false },
      longitude: { type: DataTypes.DECIMAL(9, 6), allowNull: false },
      node_id: { type: DataTypes.BIGINT, allowNull: true },
      geom: { type: DataTypes.GEOMETRY('POINT', 4326), allowNull: true },
      flood_depth_cm: { type: DataTypes.DECIMAL(8, 2), allowNull: true },
      description: { type: DataTypes.TEXT, allowNull: true },
      image_url: { type: DataTypes.TEXT, allowNull: true },
      verified: { type: DataTypes.BOOLEAN, defaultValue: false },
      location_name: { type: DataTypes.STRING(512), allowNull: true },
      reported_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: 'actual_flood_reports',
      timestamps: false,
      underscored: true,
    },
  )

  return ActualFloodReport
}

