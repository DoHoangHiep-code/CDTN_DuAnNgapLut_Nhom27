'use strict'

const { QueryTypes } = require('sequelize')

// Node đại diện mặc định (8 trạm hotspot có data đầy đủ)
const DEFAULT_NODES = [200001, 200002, 200003, 200004, 200005, 200006, 200007, 200008]

class DashboardRepository {
  constructor({ sequelize }) {
    this.sequelize = sequelize
  }

  /**
   * Tìm node_id khớp với từ khoá search (tìm trong location_name).
   * Trả DEFAULT_NODES nếu không có search hoặc không tìm thấy.
   */
  async resolveNodes(search) {
    if (!search || !search.trim()) return DEFAULT_NODES
    const rows = await this.sequelize.query(
      `SELECT node_id FROM grid_nodes
       WHERE location_name ILIKE :pattern
         AND node_id >= 200001
       ORDER BY node_id LIMIT 20`,
      { type: QueryTypes.SELECT, replacements: { pattern: `%${search.trim()}%` } },
    )
    const ids = rows.map((r) => Number(r.node_id))
    return ids.length > 0 ? ids : DEFAULT_NODES
  }

  async getCurrentWeather(nodes) {
    const tz = 'Asia/Ho_Chi_Minh'
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

  async getRainForecast(nodes, hours) {
    const tz = 'Asia/Ho_Chi_Minh'
    const h = Number(hours) || 24
    const sqlWm = `
      SELECT
        to_char(date_trunc('hour', (time AT TIME ZONE :tz)), 'HH24:MI') AS time,
        AVG(prcp)::float AS prcp
      FROM weather_measurements
      WHERE node_id IN (${nodes.join(',')})
        AND time >= now() - interval '${h} hours'
      GROUP BY 1 ORDER BY 1 LIMIT ${h};
    `
    const sqlFp = `
      SELECT
        to_char(date_trunc('hour', (time AT TIME ZONE :tz)), 'HH24:MI') AS time,
        AVG(flood_depth_cm)::float AS flood_depth_cm
      FROM flood_predictions
      WHERE node_id IN (${nodes.join(',')})
        AND time >= now() - interval '${h} hours'
      GROUP BY 1 ORDER BY 1 LIMIT ${h};
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

  async getCurrentFloodRiskCounts(hours) {
    const h = Number(hours) || 24
    const sql = `
      SELECT risk_level, COUNT(*)::int AS count
      FROM flood_predictions
      WHERE time >= now() - interval '${h} hours'
      GROUP BY risk_level;
    `
    return this.sequelize.query(sql, { type: QueryTypes.SELECT })
  }

  async getTempHumidity(nodes, hours) {
    const tz = 'Asia/Ho_Chi_Minh'
    const h = Number(hours) || 24
    const sql = `
      SELECT
        to_char(date_trunc('hour', (time AT TIME ZONE :tz)), 'HH24:MI') AS time,
        COALESCE(AVG(temp), 0)::float AS temp,
        COALESCE(AVG(rhum), 0)::float AS rhum
      FROM weather_measurements
      WHERE node_id IN (${nodes.join(',')})
        AND time >= now() - interval '${h} hours'
      GROUP BY 1 ORDER BY 1 LIMIT ${h};
    `
    return this.sequelize.query(sql, { type: QueryTypes.SELECT, replacements: { tz } })
  }

  async getRiskTrend(nodes, hours) {
    const tz = 'Asia/Ho_Chi_Minh'
    const h = Number(hours) || 168 // default 7 ngày
    // Khi hours <= 48: bucket theo giờ; khi > 48: bucket theo ngày
    const bucket = h <= 48 ? 'hour' : 'day'
    const fmt    = h <= 48 ? 'MM-DD HH24:00' : 'MM-DD'
    const sql = `
      SELECT
        to_char(date_trunc('${bucket}', (time AT TIME ZONE :tz)), '${fmt}') AS date,
        risk_level,
        COUNT(*)::int AS count
      FROM flood_predictions
      WHERE node_id IN (${nodes.join(',')})
        AND time >= now() - interval '${h} hours'
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
