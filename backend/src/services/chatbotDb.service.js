const { pool } = require('../db/pool')

function buildSafeFeatures(row) {
  const time = row.time ? new Date(row.time) : new Date()

  const hour = Number(row.hour ?? time.getHours())
  const month = Number(row.month ?? time.getMonth() + 1)

  // JS: Sunday = 0, Monday = 1...
  const dayofweek = time.getDay()

  const startOfYear = new Date(time.getFullYear(), 0, 0)
  const diff = time - startOfYear
  const oneDay = 1000 * 60 * 60 * 24
  const dayofyear = Math.floor(diff / oneDay)

  return {
    prcp: Number(row.prcp ?? 0),
    prcp_3h: Number(row.prcp_3h ?? 0),
    prcp_6h: Number(row.prcp_6h ?? 0),
    prcp_12h: Number(row.prcp_12h ?? 0),
    prcp_24h: Number(row.prcp_24h ?? 0),

    temp: Number(row.temp ?? 0),
    rhum: Number(row.rhum ?? 0),
    wspd: Number(row.wspd ?? 0),
    pres: Number(row.pres ?? 0),
    pressure_change_24h: Number(row.pressure_change_24h ?? 0),

    max_prcp_3h: Number(row.max_prcp_3h ?? 0),
    max_prcp_6h: Number(row.max_prcp_6h ?? 0),
    max_prcp_12h: Number(row.max_prcp_12h ?? 0),

    elevation: Number(row.elevation ?? 0),
    slope: Number(row.slope ?? 0),
    impervious_ratio: Number(row.impervious_ratio ?? 0),

    dist_to_drain_km: Number(row.dist_to_drain_km ?? 0),
    dist_to_river_km: Number(row.dist_to_river_km ?? 0),
    dist_to_pump_km: Number(row.dist_to_pump_km ?? 0),
    dist_to_main_road_km: Number(row.dist_to_main_road_km ?? 0),
    dist_to_park_km: Number(row.dist_to_park_km ?? 0),

    hour,
    dayofweek,
    month,
    dayofyear,

    hour_sin: Math.sin((2 * Math.PI * hour) / 24),
    hour_cos: Math.cos((2 * Math.PI * hour) / 24),
    month_sin: Math.sin((2 * Math.PI * month) / 12),
    month_cos: Math.cos((2 * Math.PI * month) / 12),

    rainy_season_flag: row.rainy_season_flag === true ? 1 : 0,
  }
}

async function getLatestNodeDataByKeyword(keyword) {
  const sql = `
    SELECT
      gn.node_id,
      gn.latitude,
      gn.longitude,
      gn.location_name,
      gn.grid_id,
      gn.weather_station_id,

      gn.elevation,
      gn.slope,
      gn.impervious_ratio,
      gn.dist_to_drain_km,
      gn.dist_to_river_km,
      gn.dist_to_pump_km,
      gn.dist_to_main_road_km,
      gn.dist_to_park_km,

      wm.measurement_id,
      wm.time,
      wm.temp,
      wm.rhum,
      wm.prcp,
      wm.prcp_3h,
      wm.prcp_6h,
      wm.prcp_12h,
      wm.prcp_24h,
      wm.wspd,
      wm.pres,
      wm.pressure_change_24h,
      wm.max_prcp_3h,
      wm.max_prcp_6h,
      wm.max_prcp_12h,
      wm.month,
      wm.hour,
      wm.rainy_season_flag,

      fp.prediction_id,
      fp.flood_depth_cm,
      fp.risk_level,
      fp.explanation,
      fp.time AS prediction_time
    FROM grid_nodes gn
    LEFT JOIN LATERAL (
      SELECT *
      FROM weather_measurements wm
      WHERE wm.node_id = gn.node_id
      ORDER BY wm.time DESC
      LIMIT 1
    ) wm ON true
    LEFT JOIN LATERAL (
      SELECT *
      FROM flood_predictions fp
      WHERE fp.node_id = gn.node_id
      ORDER BY fp.time DESC
      LIMIT 1
    ) fp ON true
    WHERE LOWER(COALESCE(gn.location_name, '')) LIKE LOWER($1)
       OR CAST(gn.node_id AS TEXT) = $2
       OR LOWER(COALESCE(gn.grid_id, '')) LIKE LOWER($1)
    LIMIT 1;
  `

  const result = await pool.query(sql, [`%${keyword}%`, keyword])
  const row = result.rows[0]

  if (!row) return null

  return {
    ...row,
    safe_features: buildSafeFeatures(row),
  }
}

async function getMostDangerousNode() {
  const sql = `
    SELECT
      gn.node_id,
      gn.latitude,
      gn.longitude,
      gn.location_name,
      gn.grid_id,

      gn.elevation,
      gn.slope,
      gn.impervious_ratio,
      gn.dist_to_drain_km,
      gn.dist_to_river_km,
      gn.dist_to_pump_km,
      gn.dist_to_main_road_km,
      gn.dist_to_park_km,

      wm.measurement_id,
      wm.time,
      wm.temp,
      wm.rhum,
      wm.prcp,
      wm.prcp_3h,
      wm.prcp_6h,
      wm.prcp_12h,
      wm.prcp_24h,
      wm.wspd,
      wm.pres,
      wm.pressure_change_24h,
      wm.max_prcp_3h,
      wm.max_prcp_6h,
      wm.max_prcp_12h,
      wm.month,
      wm.hour,
      wm.rainy_season_flag,

      fp.prediction_id,
      fp.flood_depth_cm,
      fp.risk_level,
      fp.explanation,
      fp.time AS prediction_time
    FROM flood_predictions fp
    JOIN grid_nodes gn ON gn.node_id = fp.node_id
    LEFT JOIN LATERAL (
      SELECT *
      FROM weather_measurements wm
      WHERE wm.node_id = gn.node_id
      ORDER BY wm.time DESC
      LIMIT 1
    ) wm ON true
    ORDER BY fp.flood_depth_cm DESC NULLS LAST, fp.time DESC
    LIMIT 1;
  `

  const result = await pool.query(sql)
  const row = result.rows[0]

  if (!row) return null

  return {
    ...row,
    safe_features: buildSafeFeatures(row),
  }
}

async function getCurrentFloodOverview() {
  const sql = `
    SELECT
      gn.node_id,
      gn.location_name,
      gn.latitude,
      gn.longitude,
      fp.flood_depth_cm,
      fp.risk_level,
      fp.explanation,
      fp.time AS prediction_time,
      wm.prcp_24h,
      wm.prcp_6h,
      wm.rhum,
      wm.rainy_season_flag
    FROM flood_predictions fp
    JOIN grid_nodes gn ON gn.node_id = fp.node_id
    LEFT JOIN LATERAL (
      SELECT *
      FROM weather_measurements wm
      WHERE wm.node_id = gn.node_id
      ORDER BY wm.time DESC
      LIMIT 1
    ) wm ON true
    ORDER BY fp.time DESC, fp.flood_depth_cm DESC NULLS LAST
    LIMIT 10;
  `

  const result = await pool.query(sql)
  return result.rows
}

module.exports = {
  getLatestNodeDataByKeyword,
  getMostDangerousNode,
  getCurrentFloodOverview,
}