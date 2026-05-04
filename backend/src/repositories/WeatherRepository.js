const { QueryTypes } = require('sequelize')

class WeatherRepository {
  /**
   * @param {{sequelize: import('sequelize').Sequelize}} deps
   */
  constructor({ sequelize }) {
    this.sequelize = sequelize
  }

  async _withStatementTimeout(ms, fn) {
    return this.sequelize.transaction(async (t) => {
      await this.sequelize.query(`SET LOCAL statement_timeout = ${Number(ms) | 0};`, { transaction: t })
      return fn(t)
    })
  }

  /**
   * Step 1: nearest neighbor node_id using <-> (requires GIST index on geom).
   */
  async findNearestNodeId({ lat, lng }) {
    const sql = `
      SELECT gn.node_id
      FROM grid_nodes gn
      ORDER BY ST_Distance(gn.geom::geography, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography) ASC
      LIMIT 1;
    `
    return this._withStatementTimeout(4000, (t) =>
      this.sequelize
        .query(sql, {
          type: QueryTypes.SELECT,
          replacements: { lat, lng },
          transaction: t,
        })
        .then((rows) => rows?.[0]?.node_id ?? null),
    )
  }

  /**
   * Step 2: most recent weather row for node_id (dùng cho WeatherService/UI).
   */
  async getLatestWeatherByNodeId(nodeId) {
    const sql = `
      SELECT
        wm.time,
        wm.temp,
        wm.rhum,
        wm.wspd,
        wm.prcp
      FROM weather_measurements wm
      WHERE wm.node_id = :nodeId
      ORDER BY wm.time DESC
      LIMIT 1;
    `
    return this._withStatementTimeout(5000, (t) =>
      this.sequelize.query(sql, {
        type: QueryTypes.SELECT,
        replacements: { nodeId },
        transaction: t,
      }).then((rows) => rows?.[0] ?? null),
    )
  }

  /**
   * Lấy đầy đủ 30 features cho một node để truyền vào AI model.
   * Join weather_measurements (time-series) + grid_nodes (static geo features).
   * Các cột tích lũy (prcp_3h, prcp_6h...) dùng window function trên cùng node.
   */
  async getFeaturesForPrediction(nodeId) {
    const sql = `
      WITH latest AS (
        SELECT
          wm.time,
          wm.temp,
          wm.rhum,
          wm.wspd,
          COALESCE(wm.prcp, 0)      AS prcp,
          COALESCE(wm.prcp_3h, 0)   AS prcp_3h,
          COALESCE(wm.prcp_24h, 0)  AS prcp_24h,
          -- prcp_6h, prcp_12h: tính từ window nếu DB chưa có cột riêng
          COALESCE(
            (SELECT COALESCE(SUM(w2.prcp), 0)
             FROM weather_measurements w2
             WHERE w2.node_id = wm.node_id
               AND w2.time >= wm.time - interval '6 hours'
               AND w2.time <= wm.time), 0
          )::float AS prcp_6h,
          COALESCE(
            (SELECT COALESCE(SUM(w2.prcp), 0)
             FROM weather_measurements w2
             WHERE w2.node_id = wm.node_id
               AND w2.time >= wm.time - interval '12 hours'
               AND w2.time <= wm.time), 0
          )::float AS prcp_12h,
          -- max_prcp trong cửa sổ
          COALESCE(
            (SELECT MAX(w2.prcp)
             FROM weather_measurements w2
             WHERE w2.node_id = wm.node_id
               AND w2.time >= wm.time - interval '3 hours'
               AND w2.time <= wm.time), 0
          )::float AS max_prcp_3h,
          COALESCE(
            (SELECT MAX(w2.prcp)
             FROM weather_measurements w2
             WHERE w2.node_id = wm.node_id
               AND w2.time >= wm.time - interval '6 hours'
               AND w2.time <= wm.time), 0
          )::float AS max_prcp_6h,
          COALESCE(
            (SELECT MAX(w2.prcp)
             FROM weather_measurements w2
             WHERE w2.node_id = wm.node_id
               AND w2.time >= wm.time - interval '12 hours'
               AND w2.time <= wm.time), 0
          )::float AS max_prcp_12h,
          -- pressure_change_24h
          COALESCE(wm.pres, 1010) - COALESCE(
            (SELECT w2.pres FROM weather_measurements w2
             WHERE w2.node_id = wm.node_id
               AND w2.time <= wm.time - interval '24 hours'
             ORDER BY w2.time DESC LIMIT 1), COALESCE(wm.pres, 1010)
          ) AS pressure_change_24h,
          COALESCE(wm.pres, 1010) AS pres
        FROM weather_measurements wm
        WHERE wm.node_id = :nodeId
        ORDER BY wm.time DESC
        LIMIT 1
      )
      SELECT
        l.*,
        gn.elevation,
        gn.slope,
        gn.impervious_ratio,
        COALESCE(gn.dist_to_drain_km, 0.5)    AS dist_to_drain_km,
        COALESCE(gn.dist_to_river_km, 1.0)    AS dist_to_river_km,
        COALESCE(gn.dist_to_pump_km, 1.0)     AS dist_to_pump_km,
        COALESCE(gn.dist_to_main_road_km, 0.3) AS dist_to_main_road_km,
        COALESCE(gn.dist_to_park_km, 0.5)     AS dist_to_park_km
      FROM latest l
      CROSS JOIN grid_nodes gn
      WHERE gn.node_id = :nodeId;
    `
    return this._withStatementTimeout(8000, (t) =>
      this.sequelize.query(sql, {
        type: QueryTypes.SELECT,
        replacements: { nodeId },
        transaction: t,
      }).then((rows) => rows?.[0] ?? null),
    )
  }

  /**
   * Lấy tất cả node_id để chạy batch prediction.
   */
  async getAllNodeIds() {
    const sql = `SELECT node_id FROM grid_nodes ORDER BY node_id;`
    return this._withStatementTimeout(5000, (t) =>
      this.sequelize.query(sql, { type: QueryTypes.SELECT, transaction: t })
        .then((rows) => rows.map((r) => r.node_id)),
    )
  }

  /**
   * Lấy tất cả nodes kèm latest weather row – dùng để build FloodDistrict shape cho frontend.
   * Trả về mảng rows với đủ fields cho _buildFeatures() + lat/lng để vẽ polygon.
   */
  async getAllNodesWithLatestWeather() {
    const sql = `
      SELECT DISTINCT ON (gn.node_id)
        gn.node_id,
        gn.latitude                                   AS lat,
        gn.longitude                                  AS lng,
        gn.elevation,
        gn.slope,
        gn.impervious_ratio,
        COALESCE(gn.dist_to_drain_km,    0.5)         AS dist_to_drain_km,
        COALESCE(gn.dist_to_river_km,    1.0)         AS dist_to_river_km,
        COALESCE(gn.dist_to_pump_km,     1.0)         AS dist_to_pump_km,
        COALESCE(gn.dist_to_main_road_km, 0.3)        AS dist_to_main_road_km,
        COALESCE(gn.dist_to_park_km,     0.5)         AS dist_to_park_km,
        wm.time,
        COALESCE(wm.temp,     28)::float              AS temp,
        COALESCE(wm.rhum,     70)::float              AS rhum,
        COALESCE(wm.wspd,      0)::float              AS wspd,
        COALESCE(wm.prcp,      0)::float              AS prcp,
        COALESCE(wm.prcp_3h,   0)::float              AS prcp_3h,
        COALESCE(wm.prcp_6h,   0)::float              AS prcp_6h,
        COALESCE(wm.prcp_12h,  0)::float              AS prcp_12h,
        COALESCE(wm.prcp_24h,  0)::float              AS prcp_24h,
        COALESCE(wm.pres,   1010)::float              AS pres,
        0::float                                      AS pressure_change_24h,
        COALESCE(wm.prcp,      0)::float              AS max_prcp_3h,
        COALESCE(wm.prcp,      0)::float              AS max_prcp_6h,
        COALESCE(wm.prcp,      0)::float              AS max_prcp_12h
      FROM grid_nodes gn
      LEFT JOIN weather_measurements wm ON wm.node_id = gn.node_id
      ORDER BY gn.node_id, wm.time DESC NULLS LAST;
    `
    return this._withStatementTimeout(8000, (t) =>
      this.sequelize.query(sql, { type: QueryTypes.SELECT, transaction: t }),
    )
  }

  /**
   * Step 3: 7-day forecast (next 7 days) bucketed by local day.
   * CRITICAL: use time_bucket with AT TIME ZONE Asia/Ho_Chi_Minh in SQL.
   */
  async get7DayForecastByNodeId(nodeId) {
    const tz = 'Asia/Ho_Chi_Minh'
    const sql = `
      SELECT
        date_trunc('day', (wm.time AT TIME ZONE :tz))::timestamp AS date,
        MIN(wm.temp)::float AS "minTemp",
        MAX(wm.temp)::float AS "maxTemp",
        COALESCE(SUM(wm.prcp), 0)::float AS "totalRain"
      FROM weather_measurements wm
      WHERE wm.node_id = :nodeId
        AND wm.time >= now()
        AND wm.time < now() + interval '7 days'
      GROUP BY date
      ORDER BY date ASC;
    `
    return this._withStatementTimeout(9000, (t) =>
      this.sequelize.query(sql, {
        type: QueryTypes.SELECT,
        replacements: { nodeId, tz },
        transaction: t,
      }),
    )
  }
}

module.exports = { WeatherRepository }

