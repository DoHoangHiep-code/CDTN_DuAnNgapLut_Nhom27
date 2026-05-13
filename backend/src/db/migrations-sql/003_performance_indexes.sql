-- ============================================================
-- Migration 003: Performance Indexes cho Flood Prediction
-- Chạy 1 lần: psql $DATABASE_URL -f 003_performance_indexes.sql
-- ============================================================

-- 1. Composite index (latitude, longitude) trên grid_nodes
--    → Tăng tốc BBox query trong FloodPredictionController
--    → Dùng cho: WHERE lat BETWEEN x AND y AND lng BETWEEN a AND b
CREATE INDEX IF NOT EXISTS idx_grid_nodes_lat_lng
  ON grid_nodes (latitude, longitude);

-- 2. Index (node_id, time DESC) trên flood_predictions
--    → Tăng tốc LATERAL subquery "ORDER BY time DESC LIMIT 1"
--    → Giảm từ full scan xuống còn index scan per node
CREATE INDEX IF NOT EXISTS idx_flood_predictions_node_time
  ON flood_predictions (node_id, time DESC);

-- 3. Index (node_id, time DESC) trên weather_measurements
--    → Tăng tốc LATERAL trong floodFeature.service.js
CREATE INDEX IF NOT EXISTS idx_weather_measurements_node_time
  ON weather_measurements (node_id, time DESC);

-- 4. Index grid_id trên grid_nodes (lookup theo chatbot grid_id)
CREATE INDEX IF NOT EXISTS idx_grid_nodes_grid_id
  ON grid_nodes (grid_id)
  WHERE grid_id IS NOT NULL;

-- Kiểm tra kết quả:
-- SELECT indexname, tablename FROM pg_indexes
-- WHERE tablename IN ('grid_nodes','flood_predictions','weather_measurements')
-- ORDER BY tablename, indexname;
