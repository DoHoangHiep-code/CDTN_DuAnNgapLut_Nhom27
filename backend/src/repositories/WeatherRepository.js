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
      ORDER BY gn.geom <-> ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)
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
   * Step 2: most recent weather row for node_id.
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
   * Step 3: 7-day forecast (next 7 days) bucketed by local day.
   * CRITICAL: use time_bucket with AT TIME ZONE Asia/Ho_Chi_Minh in SQL.
   */
  async get7DayForecastByNodeId(nodeId) {
    const tz = 'Asia/Ho_Chi_Minh'
    const sql = `
      SELECT
        (time_bucket('1 day', (wm.time AT TIME ZONE :tz)))::timestamp AS date,
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

