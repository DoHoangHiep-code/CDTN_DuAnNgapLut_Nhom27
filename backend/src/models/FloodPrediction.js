const { DataTypes } = require('sequelize')

module.exports = (sequelize) => {
  const FloodPrediction = sequelize.define(
    'FloodPrediction',
    {
      prediction_id:  { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
      node_id:        { type: DataTypes.BIGINT, allowNull: false },
      time:           { type: DataTypes.DATE,   allowNull: false },
      flood_depth_cm: { type: DataTypes.DECIMAL(6, 2), allowNull: false },
      risk_level:     { type: DataTypes.ENUM('safe', 'medium', 'high', 'severe'), allowNull: false },

      // Cột mô tả sơ bộ do Cronjob sinh ra dựa trên risk_level + thời tiết
      explanation: { type: DataTypes.TEXT, allowNull: true },

      // ── BI Time-Intelligence fields ───────────────────────────────────────
      date_only:        { type: DataTypes.DATEONLY, allowNull: true }, // YYYY-MM-DD (date slicer Power BI)
      month:            { type: DataTypes.INTEGER,  allowNull: true }, // 1–12
      hour:             { type: DataTypes.INTEGER,  allowNull: true }, // 0–23
      rainy_season_flag:{ type: DataTypes.BOOLEAN,  allowNull: true }, // true = tháng 5–10

      // ── De-normalize từ GridNode (để báo cáo nhanh, tránh JOIN) ──────────
      location_name: { type: DataTypes.STRING(512), allowNull: true },
    },
    {
      tableName:   'flood_predictions',
      timestamps:  false,
      underscored: true,
      indexes: [
        {
          // unique: true → cho phép dùng bulkCreate updateOnDuplicate (ON CONFLICT)
          name:   'uq_floodpred_node_time',
          unique:  true,
          fields:  ['node_id', 'time'],
        },
        { name: 'idx_floodpred_date_only', fields: ['date_only'] },
        { name: 'idx_floodpred_month',     fields: ['month'] },
        { name: 'idx_floodpred_risk',      fields: ['risk_level'] },
      ],
    },
  )

  return FloodPrediction
}
