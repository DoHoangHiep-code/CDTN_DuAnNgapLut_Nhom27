const { DataTypes } = require('sequelize')

module.exports = (sequelize) => {
  const WeatherMeasurement = sequelize.define(
    'WeatherMeasurement',
    {
      measurement_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
      node_id: { type: DataTypes.BIGINT, allowNull: false },
      time: { type: DataTypes.DATE, allowNull: false },
      temp: { type: DataTypes.DECIMAL, allowNull: true },
      rhum: { type: DataTypes.DECIMAL, allowNull: true },
      prcp: { type: DataTypes.DECIMAL, allowNull: true },
      prcp_3h: { type: DataTypes.DECIMAL, allowNull: true },
      prcp_24h: { type: DataTypes.DECIMAL, allowNull: true },
      wspd: { type: DataTypes.DECIMAL, allowNull: true },
    },
    {
      tableName: 'weather_measurements',
      timestamps: false,
      underscored: true,
      indexes: [{ name: 'idx_weather_node_time', fields: ['node_id', 'time'] }],
    },
  )

  return WeatherMeasurement
}

