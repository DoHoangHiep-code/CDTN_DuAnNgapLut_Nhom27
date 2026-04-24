const { DataTypes } = require('sequelize')

module.exports = (sequelize) => {
  const FloodPrediction = sequelize.define(
    'FloodPrediction',
    {
      prediction_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
      node_id:        { type: DataTypes.BIGINT, allowNull: false },
      time:           { type: DataTypes.DATE,   allowNull: false },
      flood_depth_cm: { type: DataTypes.DECIMAL(6, 2), allowNull: false },
      risk_level:     { type: DataTypes.ENUM('safe', 'medium', 'high', 'severe'), allowNull: false },
      // Cột mô tả sơ bộ do Cronjob sinh ra dựa trên risk_level + thời tiết
      explanation:    { type: DataTypes.TEXT, allowNull: true },
    },
    {
      tableName: 'flood_predictions',
      timestamps: false,
      underscored: true,
      indexes: [
        {
          // unique: true → cho phép dùng bulkCreate updateOnDuplicate (ON CONFLICT)
          name:   'uq_floodpred_node_time',
          unique:  true,
          fields:  ['node_id', 'time'],
        },
      ],
    },
  )

  return FloodPrediction
}

