-- 1. Bảng Data Tĩnh (GIS)
CREATE TABLE IF NOT EXISTS landslide_grid_nodes (
    node_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    province VARCHAR(100),
    location_name VARCHAR(255),
    lat FLOAT NOT NULL,
    lon FLOAT NOT NULL,
    elevation FLOAT,
    slope FLOAT,
    aspect FLOAT,
    hillshade FLOAT,
    curvature_plan FLOAT,
    curvature_profile FLOAT,
    tpi FLOAT,
    tri FLOAT,
    roughness FLOAT,
    twi FLOAT,
    dist_to_river_m FLOAT,
    dist_to_road_m FLOAT,
    ndvi FLOAT,
    evi FLOAT,
    ndwi FLOAT,
    bsi FLOAT,
    lulc_class VARCHAR(50)
);
CREATE INDEX IF NOT EXISTS idx_landslide_coords ON landslide_grid_nodes (lat, lon);

-- 2. Bảng Data Động (Thời tiết & AI)
CREATE TABLE IF NOT EXISTS landslide_predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id UUID REFERENCES landslide_grid_nodes(node_id) ON DELETE CASCADE,
    prediction_time TIMESTAMP NOT NULL,
    
    -- API Mưa & Độ ẩm
    rain_1d_accum FLOAT, rain_3d_accum FLOAT, rain_7d_accum FLOAT, rain_14d_accum FLOAT, rain_30d_accum FLOAT,
    max_rain_1d_in_7d FLOAT, max_rain_1d_in_3d FLOAT,
    api_7d FLOAT, api_14d FLOAT,
    soil_moisture_1d FLOAT, soil_moisture_7d FLOAT,
    
    -- Biến tương tác (Dẫn xuất)
    slope_x_deforestation FLOAT, twi_x_rain7d FLOAT, rain_intensity_ratio FLOAT,
    
    -- Kết quả AI
    prob_landslide FLOAT, risk_level VARCHAR(20),
    
    UNIQUE(node_id, prediction_time)
);
CREATE INDEX IF NOT EXISTS idx_landslide_pred_time ON landslide_predictions (prediction_time DESC);
