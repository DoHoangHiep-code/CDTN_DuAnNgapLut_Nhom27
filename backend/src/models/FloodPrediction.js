const { DataTypes } = require('sequelize')

module.exports = (sequelize) => {
  const FloodPrediction = sequelize.define(
    'FloodPrediction',
    {
      prediction_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
      node_id: { type: DataTypes.BIGINT, allowNull: false },
      time: { type: DataTypes.DATE, allowNull: false },
      flood_depth_cm: { type: DataTypes.DECIMAL(6, 2), allowNull: false },
      risk_level: { type: DataTypes.ENUM('safe', 'medium', 'high', 'severe'), allowNull: false },
    },
    {
      tableName: 'flood_predictions',
      timestamps: false,
      underscored: true,
      indexes: [{ name: 'idx_floodpred_node_time', fields: ['node_id', 'time'] }],
    },
  )

  return FloodPrediction
}

