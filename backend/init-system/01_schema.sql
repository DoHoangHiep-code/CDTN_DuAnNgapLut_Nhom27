-- =============================================================================
-- AQUAALERT – 01_schema.sql
-- Schema CockroachDB / PostgreSQL đầy đủ (tạo từ đầu)
-- Chạy: psql $DATABASE_URL -f 01_schema.sql
-- =============================================================================

-- Bật extension PostGIS (CockroachDB hỗ trợ sẵn, bỏ qua nếu lỗi)
CREATE EXTENSION IF NOT EXISTS postgis;

-- =============================================================================
-- ENUM TYPES
-- =============================================================================
DO $$ BEGIN
  CREATE TYPE risk_level_enum AS ENUM ('safe', 'medium', 'high', 'severe');

EXCEPTION WHEN duplicate_object THEN NULL;

END $$;

DO $$ BEGIN
  CREATE TYPE user_role_enum AS ENUM ('admin', 'expert', 'user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================================
-- TABLE: users
-- =============================================================================
CREATE TABLE IF NOT EXISTS users (
    user_id BIGSERIAL PRIMARY KEY,
    username VARCHAR(64) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    full_name VARCHAR(256),
    password_hash TEXT NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'user',
    avatar_url VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- TABLE: weather_stations (Trạm thời tiết ảo 3×3km)
-- =============================================================================
CREATE TABLE IF NOT EXISTS weather_stations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    latitude DECIMAL(9, 6) NOT NULL,
    longitude DECIMAL(9, 6) NOT NULL,
    node_count INTEGER NOT NULL DEFAULT 0,
    grid_row INTEGER,
    grid_col INTEGER,
    location_name VARCHAR(512)
);

CREATE INDEX IF NOT EXISTS idx_weather_stations_lat_lon ON weather_stations (latitude, longitude);

-- =============================================================================
-- TABLE: grid_nodes (53.330 điểm lưới dự báo)
-- =============================================================================
CREATE TABLE IF NOT EXISTS grid_nodes (
    node_id BIGINT PRIMARY KEY,
    latitude DECIMAL(9, 6) NOT NULL,
    longitude DECIMAL(9, 6) NOT NULL,
    elevation DECIMAL(8, 3),
    slope DECIMAL(8, 4),
    impervious_ratio DECIMAL(6, 4),
    geom GEOMETRY (POINT, 4326) NOT NULL,
    dist_to_drain_km DECIMAL(10, 4),
    dist_to_river_km DECIMAL(10, 4),
    dist_to_pump_km DECIMAL(10, 4),
    dist_to_main_road_km DECIMAL(10, 4),
    dist_to_park_km DECIMAL(10, 4),
    district_name VARCHAR(255),
    location_name VARCHAR(512),
    grid_id VARCHAR(64),
    weather_station_id INTEGER,
    -- IDW: 3 trạm gần nhất + trọng số (w1+w2+w3=1.0)
    st1_id DOUBLE PRECISION,
    st1_weight DOUBLE PRECISION,
    st2_id DOUBLE PRECISION,
    st2_weight DOUBLE PRECISION,
    st3_id DOUBLE PRECISION,
    st3_weight DOUBLE PRECISION,
    is_out_of_bounds BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT uq_grid_lat_lon UNIQUE (latitude, longitude)
);

CREATE INDEX IF NOT EXISTS idx_grid_nodes_geom_gist ON grid_nodes USING GIST (geom);

CREATE INDEX IF NOT EXISTS idx_grid_nodes_lat_lng ON grid_nodes (latitude, longitude);

CREATE INDEX IF NOT EXISTS idx_grid_station ON grid_nodes (weather_station_id);

CREATE INDEX IF NOT EXISTS idx_grid_st1 ON grid_nodes (st1_id);

-- =============================================================================
-- TABLE: weather_measurements (88 rows/cron × 72h)
-- =============================================================================
CREATE TABLE IF NOT EXISTS weather_measurements (
    measurement_id BIGSERIAL PRIMARY KEY,
    node_id BIGINT NOT NULL REFERENCES grid_nodes (node_id),
    time TIMESTAMPTZ NOT NULL,
    date_only DATE,
    month SMALLINT,
    hour SMALLINT,
    rainy_season_flag BOOLEAN,
    temp DECIMAL(6, 2),
    rhum DECIMAL(5, 2),
    clouds DECIMAL(5, 2),
    prcp DECIMAL(8, 3),
    prcp_3h DECIMAL(8, 3),
    prcp_6h DECIMAL(8, 3),
    prcp_12h DECIMAL(8, 3),
    prcp_24h DECIMAL(8, 3),
    wspd DECIMAL(7, 3),
    wdir DECIMAL(6, 2),
    pres DECIMAL(8, 2),
    pressure_change_24h DECIMAL(8, 2),
    max_prcp_3h DECIMAL(8, 3),
    max_prcp_6h DECIMAL(8, 3),
    max_prcp_12h DECIMAL(8, 3),
    visibility_km DECIMAL(8, 3),
    feels_like_c DECIMAL(6, 2),
    CONSTRAINT uq_weather_node_time UNIQUE (node_id, time)
);

CREATE INDEX IF NOT EXISTS idx_weather_node_time ON weather_measurements (node_id, time DESC);

CREATE INDEX IF NOT EXISTS idx_weather_date_only ON weather_measurements (date_only);

CREATE INDEX IF NOT EXISTS idx_weather_month ON weather_measurements (month);

-- =============================================================================
-- TABLE: flood_predictions (53K nodes × 72h = ~3.8M rows rolling)
-- =============================================================================
CREATE TABLE IF NOT EXISTS flood_predictions (
    prediction_id BIGSERIAL PRIMARY KEY,
    node_id BIGINT NOT NULL REFERENCES grid_nodes (node_id),
    time TIMESTAMPTZ NOT NULL,
    flood_depth_cm DECIMAL(8, 2),
    target SMALLINT,
    risk_level VARCHAR(16),
    explanation TEXT,
    date_only DATE,
    month SMALLINT,
    hour SMALLINT,
    rainy_season_flag BOOLEAN,
    CONSTRAINT uq_floodpred_node_time UNIQUE (node_id, time)
);

CREATE INDEX IF NOT EXISTS idx_floodpred_node_time_desc ON flood_predictions (node_id, time DESC);

CREATE INDEX IF NOT EXISTS idx_floodpred_date_only ON flood_predictions (date_only);

CREATE INDEX IF NOT EXISTS idx_floodpred_month ON flood_predictions (month);

CREATE INDEX IF NOT EXISTS idx_floodpred_risk ON flood_predictions (risk_level);

CREATE INDEX IF NOT EXISTS idx_floodpred_depth ON flood_predictions (flood_depth_cm);

-- =============================================================================
-- TABLE: actual_flood_reports
-- =============================================================================
CREATE TABLE IF NOT EXISTS actual_flood_reports (
    report_id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users (user_id),
    reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    latitude DECIMAL(9, 6),
    longitude DECIMAL(9, 6),
    geom GEOMETRY (POINT, 4326),
    flood_depth_cm DECIMAL(8, 2),
    description TEXT,
    image_url TEXT,
    verified BOOLEAN DEFAULT FALSE,
    node_id BIGINT REFERENCES grid_nodes (node_id)
);

CREATE INDEX IF NOT EXISTS idx_actual_flood_reports_geom_gist ON actual_flood_reports USING GIST (geom);

-- =============================================================================
-- TABLE: system_logs
-- =============================================================================
CREATE TABLE IF NOT EXISTS system_logs (
    log_id BIGSERIAL PRIMARY KEY,
    admin_id BIGINT REFERENCES users (user_id),
    event_type VARCHAR(64),
    event_source VARCHAR(128),
    message TEXT,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- MATERIALIZED VIEWS
-- =============================================================================

-- MV: Dự báo mới nhất mỗi node
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_latest_flood_predictions AS
SELECT DISTINCT
    ON (node_id) prediction_id,
    node_id,
    time,
    flood_depth_cm,
    risk_level,
    explanation,
    date_only,
    month,
    hour,
    rainy_season_flag
FROM flood_predictions
ORDER BY node_id, time DESC;

CREATE UNIQUE INDEX IF NOT EXISTS mv_latest_flood_predictions_pkey ON mv_latest_flood_predictions (prediction_id);

CREATE INDEX IF NOT EXISTS idx_mv_latest_fp_node_id ON mv_latest_flood_predictions (node_id);

-- MV: Trung bình ngập theo thời gian
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_global_flood_avg AS
SELECT
  time,
  date_only,
  hour,
  AVG(flood_depth_cm)::DECIMAL(8,2) AS avg_depth_cm,
  COUNT(*) AS node_count
FROM flood_predictions
GROUP BY time, date_only, hour
ORDER BY time;

CREATE UNIQUE INDEX IF NOT EXISTS mv_global_flood_avg_pkey ON mv_global_flood_avg (time);

CREATE INDEX IF NOT EXISTS idx_mv_global_flood_avg_time ON mv_global_flood_avg (time);

-- MV: Xu hướng risk level theo giờ
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_global_risk_trend AS
SELECT
    time,
    date_only,
    hour,
    risk_level,
    COUNT(*) AS node_count
FROM flood_predictions
GROUP BY
    time,
    date_only,
    hour,
    risk_level
ORDER BY time;

CREATE UNIQUE INDEX IF NOT EXISTS mv_global_risk_trend_pkey ON mv_global_risk_trend (time, risk_level);

CREATE INDEX IF NOT EXISTS idx_mv_global_risk_trend_time ON mv_global_risk_trend (time);

-- =============================================================================
-- DONE
-- =============================================================================
-- Bước tiếp theo:
--   1. Chạy: node init-system/03_scripts/setup_virtual_stations.js
--   2. Chạy: node init-system/redeploy.js
-- =============================================================================