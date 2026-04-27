const { DataTypes } = require('sequelize')

module.exports = (sequelize) => {
  const GridNode = sequelize.define(
    'GridNode',
    {
      node_id: { type: DataTypes.BIGINT, primaryKey: true, allowNull: false },
      latitude: { type: DataTypes.DECIMAL(9, 6), allowNull: false },
      longitude: { type: DataTypes.DECIMAL(9, 6), allowNull: false },
      elevation: { type: DataTypes.DECIMAL(6, 2), allowNull: false },
      slope: { type: DataTypes.DECIMAL(6, 2), allowNull: false },
      impervious_ratio: { type: DataTypes.DECIMAL(4, 3), allowNull: false },
      geom: { type: DataTypes.GEOMETRY('POINT', 4326), allowNull: false },

      // Các trường khoảng cách phục vụ feature engineering cho AI.
      // Trước đây query đã COALESCE nhưng DB thiếu cột -> lỗi "column ... does not exist".
      // Để null được vì ta sẽ COALESCE về giá trị mặc định trong query/repository.
      dist_to_drain_km: { type: DataTypes.DECIMAL(10, 3), allowNull: true },
      dist_to_river_km: { type: DataTypes.DECIMAL(10, 3), allowNull: true },
      dist_to_pump_km: { type: DataTypes.DECIMAL(10, 3), allowNull: true },
      dist_to_main_road_km: { type: DataTypes.DECIMAL(10, 3), allowNull: true },
      dist_to_park_km: { type: DataTypes.DECIMAL(10, 3), allowNull: true },
    },
    {
      tableName: 'grid_nodes',
      timestamps: false,
      underscored: true,
    },
  )

  return GridNode
}

