const { DataTypes } = require('sequelize')

module.exports = (sequelize) => {
  const SystemLog = sequelize.define(
    'SystemLog',
    {
      log_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
      admin_id: { type: DataTypes.BIGINT, allowNull: true },
      event_type: { type: DataTypes.STRING(100), allowNull: false },
      event_source: { type: DataTypes.STRING(255), allowNull: false },
      message: { type: DataTypes.TEXT, allowNull: false },
      timestamp: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: 'system_logs',
      timestamps: false,
      underscored: true,
    },
  )

  return SystemLog
}

