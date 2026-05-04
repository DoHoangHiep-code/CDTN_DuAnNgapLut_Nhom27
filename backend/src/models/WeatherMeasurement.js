const { DataTypes } = require('sequelize')

module.exports = (sequelize) => {
  const WeatherMeasurement = sequelize.define(
    'WeatherMeasurement',
    {
      measurement_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
      node_id: { type: DataTypes.BIGINT, allowNull: false },
      time:    { type: DataTypes.DATE,   allowNull: false },

      // ── Khí tượng cơ bản ──────────────────────────────────────────────────
      temp:    { type: DataTypes.DECIMAL(6, 2),  allowNull: true }, // Nhiệt độ (°C)
      rhum:    { type: DataTypes.DECIMAL(5, 2),  allowNull: true }, // Độ ẩm (%)
      clouds:  { type: DataTypes.INTEGER,        allowNull: false, defaultValue: 0 }, // Tỷ lệ mây (%)
      prcp:    { type: DataTypes.DECIMAL(8, 3),  allowNull: true }, // Mưa 1h (mm)
      prcp_3h: { type: DataTypes.DECIMAL(8, 3),  allowNull: true }, // Mưa 3h (mm)
      prcp_6h: { type: DataTypes.DECIMAL(8, 3),  allowNull: true }, // Mưa 6h (mm)
      prcp_12h:{ type: DataTypes.DECIMAL(8, 3),  allowNull: true }, // Mưa 12h (mm)
      prcp_24h:{ type: DataTypes.DECIMAL(8, 3),  allowNull: true }, // Mưa 24h (mm)
      wspd:    { type: DataTypes.DECIMAL(6, 3),  allowNull: true }, // Tốc độ gió (m/s)
      wdir:    { type: DataTypes.DECIMAL(5, 1),  allowNull: true }, // Hướng gió (°)
      pres:    { type: DataTypes.DECIMAL(8, 3),  allowNull: true }, // Áp suất (hPa)
      pressure_change_24h: { type: DataTypes.DECIMAL(7, 3), allowNull: true }, // Thay đổi áp suất 24h

      // ── Rolling max (feature engineering AI) ─────────────────────────────
      max_prcp_3h:  { type: DataTypes.DECIMAL(8, 3), allowNull: true },
      max_prcp_6h:  { type: DataTypes.DECIMAL(8, 3), allowNull: true },
      max_prcp_12h: { type: DataTypes.DECIMAL(8, 3), allowNull: true },

      // ── Power BI dimensional fields ───────────────────────────────────────
      visibility_km:  { type: DataTypes.DECIMAL(6, 2),  allowNull: true }, // Tầm nhìn (km)
      feels_like_c:   { type: DataTypes.DECIMAL(5, 2),  allowNull: true }, // Cảm giác thực (°C)

      // ── BI Time-Intelligence fields ───────────────────────────────────────
      date_only:        { type: DataTypes.DATEONLY,  allowNull: true }, // YYYY-MM-DD (date slicer Power BI)
      month:            { type: DataTypes.INTEGER,   allowNull: true }, // 1–12
      hour:             { type: DataTypes.INTEGER,   allowNull: true }, // 0–23
      rainy_season_flag:{ type: DataTypes.BOOLEAN,   allowNull: true }, // true = tháng 5–10

      // ── De-normalize từ GridNode (để báo cáo nhanh, tránh JOIN) ──────────
      location_name: { type: DataTypes.STRING(512), allowNull: true },
    },
    {
      tableName:   'weather_measurements',
      timestamps:  false,
      underscored: true,
      indexes: [
        { name: 'idx_weather_node_time', fields: ['node_id', 'time'] },
        { name: 'idx_weather_date_only', fields: ['date_only'] },
        { name: 'idx_weather_month',     fields: ['month'] },
      ],
    },
  )

  return WeatherMeasurement
}
