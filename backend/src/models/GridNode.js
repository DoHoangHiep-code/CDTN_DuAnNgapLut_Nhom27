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
    },
    {
      tableName: 'grid_nodes',
      timestamps: false,
      underscored: true,
    },
  )

  return GridNode
}

