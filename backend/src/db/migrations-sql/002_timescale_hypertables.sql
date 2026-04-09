-- TimescaleDB hypertable setup
-- Run after base tables are created.

-- Weather measurements hypertable
SELECT create_hypertable('weather_measurements', 'time', if_not_exists => TRUE);

-- Flood predictions hypertable
SELECT create_hypertable('flood_predictions', 'time', if_not_exists => TRUE);

