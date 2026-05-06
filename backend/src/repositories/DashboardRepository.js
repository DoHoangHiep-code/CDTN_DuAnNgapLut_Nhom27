'use strict'

const { QueryTypes } = require('sequelize')

class DashboardRepository {
  constructor({ sequelize }) {
    this.sequelize = sequelize
  }

  // 8 trạm đại diện — dùng index compound (node_id, time) để tránh full-scan
  static get SAMPLE_NODES() { return [200001, 200002, 200003, 200004, 200005, 200006, 200007, 200008] }

  async getCurrentWeather() {
    const tz = 'Asia/Ho_Chi_Minh'
    const nodes = DashboardRepository.SAMPLE_NODES
    const sql = `
      SELECT
        COALESCE(AVG(temp), 0)::float AS temperature,
        COALESCE(AVG(rhum), 0)::float AS humidity,
        COALESCE(AVG(wspd), 0)::float AS wind_speed
      FROM weather_measurements
      WHERE node_id IN (${nodes.join(',')})
        AND time >= date_trunc('hour', now() AT TIME ZONE :tz) AT TIME ZONE :tz
        AND time <  (date_trunc('hour', now() AT TIME ZONE :tz) + interval '1 hour') AT TIME ZONE :tz;
    `
    const rows = await this.sequelize.query(sql, { type: QueryTypes.SELECT, replacements: { tz } })
    return rows[0] || null
  }

  async getRainForecast24h() {
    const tz = 'Asia/Ho_Chi_Minh'
    const nodes = DashboardRepository.SAMPLE_NODES
    const sqlWm = `
      SELECT
        to_char(date_trunc('hour', (time AT TIME ZONE :tz)), 'HH24:MI') AS time,
        AVG(prcp)::float AS prcp
      FROM weather_measurements
      WHERE node_id IN (${nodes.join(',')})
        AND time >= now() - interval '24 hours'
      GROUP BY 1 ORDER BY 1 LIMIT 24;
    `
    const sqlFp = `
      SELECT
        to_char(date_trunc('hour', (time AT TIME ZONE :tz)), 'HH24:MI') AS time,
        AVG(flood_depth_cm)::float AS flood_depth_cm
      FROM flood_predictions
      WHERE node_id IN (${nodes.join(',')})
        AND time >= now() - interval '24 hours'
      GROUP BY 1 ORDER BY 1 LIMIT 24;
    `
    const [wmRows, fpRows] = await Promise.all([
      this.sequelize.query(sqlWm, { type: QueryTypes.SELECT, replacements: { tz } }),
      this.sequelize.query(sqlFp, { type: QueryTypes.SELECT, replacements: { tz } }),
    ])
    const fpMap = new Map(fpRows.map((r) => [r.time, r.flood_depth_cm]))
    return wmRows.map((r) => ({
      time: r.time,
      prcp: Number(r.prcp) || 0,
      flood_depth_cm: Number(fpMap.get(r.time) ?? 0),
    }))
  }

  async getCurrentFloodRiskCounts() {
    const sql = `
      SELECT risk_level, COUNT(*)::int AS count
      FROM flood_predictions
      WHERE time >= now() - interval '2 hours'
      GROUP BY risk_level;
    `
    return this.sequelize.query(sql, { type: QueryTypes.SELECT })
  }

  async getTempHumidity24h() {
    const tz = 'Asia/Ho_Chi_Minh'
    const nodes = DashboardRepository.SAMPLE_NODES
    const sql = `
      SELECT
        to_char(date_trunc('hour', (time AT TIME ZONE :tz)), 'HH24:MI') AS time,
        COALESCE(AVG(temp), 0)::float AS temp,
        COALESCE(AVG(rhum), 0)::float AS rhum
      FROM weather_measurements
      WHERE node_id IN (${nodes.join(',')})
        AND time >= now() - interval '24 hours'
      GROUP BY 1 ORDER BY 1 LIMIT 24;
    `
    return this.sequelize.query(sql, { type: QueryTypes.SELECT, replacements: { tz } })
  }

  async getRiskTrend7d() {
    const tz = 'Asia/Ho_Chi_Minh'
    const nodes = DashboardRepository.SAMPLE_NODES
    const sql = `
      SELECT
        to_char(date_trunc('day', (time AT TIME ZONE :tz)), 'MM-DD') AS date,
        risk_level,
        COUNT(*)::int AS count
      FROM flood_predictions
      WHERE node_id IN (${nodes.join(',')})
        AND time >= now() - interval '7 days'
      GROUP BY 1, 2
      ORDER BY 1, 2;
    `
    return this.sequelize.query(sql, { type: QueryTypes.SELECT, replacements: { tz } })
  }

  async getRecentAlerts(limit = 10) {
    const sql = `
      SELECT report_id, created_at, latitude, longitude, reported_level
      FROM actual_flood_reports
      ORDER BY created_at DESC
      LIMIT :limit;
    `
    return this.sequelize.query(sql, { type: QueryTypes.SELECT, replacements: { limit: Number(limit) | 0 } })
  }
}

module.exports = { DashboardRepository }
