const { DataTypes } = require('sequelize')

module.exports = (sequelize) => {
  const GridNode = sequelize.define(
    'GridNode',
    {
      node_id:   { type: DataTypes.BIGINT, primaryKey: true, allowNull: false },
      latitude:  { type: DataTypes.DECIMAL(9, 6), allowNull: false },
      longitude: { type: DataTypes.DECIMAL(9, 6), allowNull: false },

      // ── Địa lý tĩnh – tất cả allowNull:true để CSV rows không bị crash nếu thiếu ──
      elevation:        { type: DataTypes.DECIMAL(8, 3), allowNull: true },
      slope:            { type: DataTypes.DECIMAL(8, 4), allowNull: true },
      impervious_ratio: { type: DataTypes.DECIMAL(6, 4), allowNull: true },

      // Cột PostGIS – bắt buộc cho spatial queries (<->, ST_Distance)
      geom: { type: DataTypes.GEOMETRY('POINT', 4326), allowNull: false },

      // ── Khoảng cách đến hạ tầng (feature engineering AI) ──
      // allowNull:true vì COALESCE về default trong query/repository
      dist_to_drain_km:     { type: DataTypes.DECIMAL(10, 4), allowNull: true },
      dist_to_river_km:     { type: DataTypes.DECIMAL(10, 4), allowNull: true },
      dist_to_pump_km:      { type: DataTypes.DECIMAL(10, 4), allowNull: true },
      dist_to_main_road_km: { type: DataTypes.DECIMAL(10, 4), allowNull: true },
      dist_to_park_km:      { type: DataTypes.DECIMAL(10, 4), allowNull: true },

      // ── Định danh địa lý (seed hotspots + CSV import) ──
      // Không bao giờ NULL sau khi import: hotspot dùng tên phố, CSV dùng "Grid_[lat]_[lon]"
      location_name: { type: DataTypes.STRING(512), allowNull: true },

      // ── grid_id gốc từ file CSV (Grid_0, Grid_1...) để tracing ──
      grid_id: { type: DataTypes.STRING(64), allowNull: true },

      // ── Trạm thời tiết đại diện (Legacy – 8 trạm cứng) ────────────────────
      weather_station_id: { type: DataTypes.INTEGER, allowNull: true },

      // ── IDW Storage (Virtual Station Grid 3x3km) ─────────────────────────
      // Lưu trữ tĩnh 3 trạm ảo gần nhất + trọng số IDW (w = 1/d²) được tính
      // 1 lần bởi scripts/calculate_idw_weights.js, chuẩn hóa tổng = 1.
      st1_id:     { type: DataTypes.FLOAT, allowNull: true },
      st1_weight: { type: DataTypes.FLOAT, allowNull: true },
      st2_id:     { type: DataTypes.FLOAT, allowNull: true },
      st2_weight: { type: DataTypes.FLOAT, allowNull: true },
      st3_id:     { type: DataTypes.FLOAT, allowNull: true },
      st3_weight: { type: DataTypes.FLOAT, allowNull: true },

      // true nếu trạm gần nhất > 15km → fallback OWM Live khi dự báo
      is_out_of_bounds: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    {
      tableName:  'grid_nodes',
      timestamps: false,
      underscored: true,
      indexes: [
        // KNN spatial index — dùng cho toán tử <-> (PostGIS nearest neighbor)
        { name: 'idx_grid_nodes_geom', fields: ['geom'], using: 'GIST' },
        // Unique lat/lon — dedup khi import CSV + cho phép upsert bằng lat/lon
        { name: 'uq_grid_lat_lon', unique: true, fields: ['latitude', 'longitude'] },
        // B-tree riêng lẻ — tốt hơn cho WHERE latitude BETWEEN x AND y (bbox query)
        { name: 'idx_grid_lat', fields: ['latitude'] },
        { name: 'idx_grid_lon', fields: ['longitude'] },
        // B-tree cho station clustering — GROUP BY / WHERE weather_station_id = ?
        { name: 'idx_grid_station', fields: ['weather_station_id'] },
      ],
    },
  )

  return GridNode
}
