const { QueryTypes } = require('sequelize')

class DashboardRepository {
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
   * Current weather for current local hour (Asia/Ho_Chi_Minh).
   * Returns averaged values over all nodes for the hour window.
   */
  async getCurrentWeather() {
    const tz = 'Asia/Ho_Chi_Minh'
    const sql = `
      WITH bounds AS (
        SELECT
          (date_trunc('hour', now() AT TIME ZONE :tz) AT TIME ZONE :tz) AS start_ts,
          ((date_trunc('hour', now() AT TIME ZONE :tz) + interval '1 hour') AT TIME ZONE :tz) AS end_ts
      )
      SELECT
        COALESCE(AVG(temp), 0)::float AS temperature,
        COALESCE(AVG(rhum), 0)::float AS humidity,
        COALESCE(AVG(wspd), 0)::float AS wind_speed
      FROM weather_measurements wm
      CROSS JOIN bounds b
      WHERE wm.time >= b.start_ts AND wm.time < b.end_ts;
    `

    return this._withStatementTimeout(5000, (t) =>
      this.sequelize.query(sql, {
        type: QueryTypes.SELECT,
        replacements: { tz },
        transaction: t,
      }).then((rows) => rows[0] || null),
    )
  }

  /**
   * 24h hourly forecast: mưa (prcp) + độ ngập dự đoán (flood_depth_cm), bucket theo local hour.
   *
   * CRITICAL:
   * - Không aggregate trong JS (để DB làm).
   * - Trả đúng field: time, prcp, flood_depth_cm (để tooltip dashboard hiển thị).
   */
  async getRainForecast24h() {
    const tz = 'Asia/Ho_Chi_Minh'
    const sql = `
      WITH wm_bucket AS (
        SELECT
          time_bucket('1 hour', (wm.time AT TIME ZONE :tz)) AS bucket_local,
          wm.prcp
        FROM weather_measurements wm
        WHERE wm.time >= now() - interval '24 hours'
      ),
      fp_bucket AS (
        SELECT
          time_bucket('1 hour', (fp.time AT TIME ZONE :tz)) AS bucket_local,
          fp.flood_depth_cm
        FROM flood_predictions fp
        WHERE fp.time >= now() - interval '24 hours'
      )
      SELECT
        to_char(b.bucket_local, 'HH24:MI') AS time,
        COALESCE(AVG(wm.prcp), 0)::float AS prcp,
        COALESCE(AVG(fp.flood_depth_cm), 0)::float AS flood_depth_cm
      FROM (
        SELECT bucket_local FROM wm_bucket
        UNION
        SELECT bucket_local FROM fp_bucket
      ) b
      LEFT JOIN wm_bucket wm ON wm.bucket_local = b.bucket_local
      LEFT JOIN fp_bucket fp ON fp.bucket_local = b.bucket_local
      GROUP BY b.bucket_local
      ORDER BY b.bucket_local ASC
      LIMIT 24;
    `

    return this._withStatementTimeout(7000, (t) =>
      this.sequelize.query(sql, {
        type: QueryTypes.SELECT,
        replacements: { tz },
        transaction: t,
      }),
    )
  }

  /**
   * Flood risk counts for CURRENT local hour only.
   * Groups by risk_level.
   */
  async getCurrentFloodRiskCounts() {
    const tz = 'Asia/Ho_Chi_Minh'
    const sql = `
      WITH bounds AS (
        SELECT
          (date_trunc('hour', now() AT TIME ZONE :tz) AT TIME ZONE :tz) AS start_ts,
          ((date_trunc('hour', now() AT TIME ZONE :tz) + interval '1 hour') AT TIME ZONE :tz) AS end_ts
      )
      SELECT fp.risk_level, COUNT(*)::int AS count
      FROM flood_predictions fp
      CROSS JOIN bounds b
      WHERE fp.time >= b.start_ts AND fp.time < b.end_ts
      GROUP BY fp.risk_level;
    `

    return this._withStatementTimeout(7000, (t) =>
      this.sequelize.query(sql, {
        type: QueryTypes.SELECT,
        replacements: { tz },
        transaction: t,
      }),
    )
  }

  /**
   * Recent actual flood reports -> alerts.
   */
  async getRecentAlerts(limit = 10) {
    const sql = `
      SELECT
        afr.report_id,
        afr.created_at,
        afr.latitude,
        afr.longitude,
        afr.reported_level
      FROM actual_flood_reports afr
      ORDER BY afr.created_at DESC
      LIMIT :limit;
    `
    return this._withStatementTimeout(5000, (t) =>
      this.sequelize.query(sql, {
        type: QueryTypes.SELECT,
        replacements: { limit: Number(limit) | 0 },
        transaction: t,
      }),
    )
  }
}

module.exports = { DashboardRepository }

