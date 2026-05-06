'use strict'

const { DataTypes } = require('sequelize')

/**
 * WeatherStation – Trạm thời tiết ảo (Virtual Station Grid 3x3km)
 *
 * Mỗi trạm là tâm của 1 ô lưới 3km × 3km trên bản đồ Hà Nội.
 * WeatherCron fetch dữ liệu OWM cho mỗi trạm ảo này.
 * Kết quả được nội suy IDW về các grid_nodes trong bán kính ảnh hưởng.
 */
module.exports = (sequelize) => {
  const WeatherStation = sequelize.define(
    'WeatherStation',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING(128),
        allowNull: false,
      },
      latitude: {
        type: DataTypes.DECIMAL(9, 6),
        allowNull: false,
      },
      longitude: {
        type: DataTypes.DECIMAL(9, 6),
        allowNull: false,
      },
      // Số grid_nodes nằm trong ô lưới này (thống kê tham khảo)
      node_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      // Vị trí ô lưới trên grid (để debug/trace)
      grid_row: { type: DataTypes.INTEGER, allowNull: true },
      grid_col: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      tableName:   'weather_stations',
      timestamps:  false,
      underscored: true,
      indexes: [
        { name: 'idx_weather_stations_lat_lon', fields: ['latitude', 'longitude'] },
      ],
    },
  )

  return WeatherStation
}
