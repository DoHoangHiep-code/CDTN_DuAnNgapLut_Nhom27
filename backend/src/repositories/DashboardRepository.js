'use strict'

const { QueryTypes } = require('sequelize')

class DashboardRepository {
  constructor({ sequelize }) {
    this.sequelize = sequelize
  }

  /**
   * Autocomplete tìm kiếm địa điểm — trả về location_name chi tiết (Đường, Xã, Huyện)
   */
  async getLocationAutocomplete(search) {
    if (!search || !search.trim()) return []
    const rows = await this.sequelize.query(
      `SELECT DISTINCT location_name
       FROM grid_nodes
       WHERE location_name ILIKE :pattern AND location_name IS NOT NULL
       ORDER BY location_name LIMIT 15`,
      { type: QueryTypes.SELECT, replacements: { pattern: `%${search.trim()}%` } },
    )
    return rows.map((r, i) => ({
      node_id: i,
      location_name: r.location_name,
      // Parse district từ phần cuối cùng của location_name (sau dấu phẩy cuối)
      district_name: (r.location_name || '').split(',').slice(-1)[0]?.trim() || '',
      weather_station_id: 0
    }))
  }

  /**
   * Trả về danh sách nodes dựa trên search (exact match location_name).
   * Nếu search rỗng -> { isGlobal: true }
   * Nếu có search -> tìm tất cả nodes thuộc location_name đó
   */
  async resolveNodes(search) {
    if (!search || !search.trim()) {
      return { isGlobal: true, predictionNodeIds: null, weatherNodeIds: null }
    }
    const rows = await this.sequelize.query(
      `SELECT node_id, weather_station_id FROM grid_nodes
       WHERE location_name = :pattern`,
      { type: QueryTypes.SELECT, replacements: { pattern: search.trim() } },
    )
    if (rows.length === 0) {
       return { isGlobal: true, predictionNodeIds: null, weatherNodeIds: null }
    }
    const predictionNodeIds = rows.map((r) => Number(r.node_id))
    const weatherNodeIds = [...new Set(rows.map((r) => Number(r.weather_station_id)).filter(id => id))]
    return { isGlobal: false, predictionNodeIds, weatherNodeIds }
  }

  /**
   * Thời tiết hiện tại — lấy bản ghi GẦN NHẤT với thời điểm hiện tại (không phải AVG 72h)
   */
  async getCurrentWeather(weatherNodeIds, isGlobal) {
    const tz = 'Asia/Ho_Chi_Minh'
    const nodesStr = isGlobal ? await this.getRepresentativeNodeIds() : weatherNodeIds.join(',')
    let whereWm = `AND node_id IN (${nodesStr})`

    const sql = `
      WITH latest_time AS (
        SELECT MAX(time) AS max_time 
        FROM weather_measurements
        WHERE time <= now()
          ${whereWm}
      )
      SELECT
        AVG(temp)::float AS temp,
        AVG(rhum)::float AS rhum,
        MAX(prcp)::float AS prcp,
        AVG(wspd)::float AS wspd,
        MAX(time) AT TIME ZONE :tz AS last_update
      FROM weather_measurements, latest_time
      WHERE time = latest_time.max_time
        ${whereWm};
    `
    const rows = await this.sequelize.query(sql, { type: QueryTypes.SELECT, replacements: { tz } })
    return rows[0] || null
  }

  /**
   * Dự báo mưa + ngập — dùng JOIN grid_nodes khi lọc theo location
   */
  async getRainForecast(weatherNodeIds, isGlobal, predictionNodeIds, hours) {
    const tz = 'Asia/Ho_Chi_Minh'
    const h = Number(hours) || 72
    const nodesStr = isGlobal ? await this.getRepresentativeNodeIds() : weatherNodeIds.join(',')
    let whereWm = `AND wm.node_id IN (${nodesStr})`

    const sqlWm = `
      SELECT
        date_trunc('hour', (wm.time AT TIME ZONE :tz)) AS real_time,
        to_char(date_trunc('hour', (wm.time AT TIME ZONE :tz)), 'DD/MM HH24:MI') AS time,
        MAX(wm.prcp)::float AS prcp
      FROM weather_measurements wm
      WHERE wm.time >= now() AND wm.time < now() + interval '${h} hours'
        ${whereWm}
      GROUP BY 1, 2 ORDER BY 1 ASC LIMIT ${h};
    `

    let sqlFp
    if (isGlobal) {
      sqlFp = `
        SELECT
          time AS real_time,
          to_char(time AT TIME ZONE :tz, 'DD/MM HH24:MI') AS time,
          avg_depth_cm AS flood_depth_cm
        FROM mv_global_flood_avg
        WHERE time >= now() AND time < now() + interval '${h} hours'
        ORDER BY 1 ASC LIMIT ${h};
      `
    } else {
      // JOIN flood_predictions với grid_nodes thông qua node_id
      const whereFp = `AND fp.node_id IN (${predictionNodeIds.join(',')})`
      sqlFp = `
        SELECT
          date_trunc('hour', (fp.time AT TIME ZONE :tz)) AS real_time,
          to_char(date_trunc('hour', (fp.time AT TIME ZONE :tz)), 'DD/MM HH24:MI') AS time,
          MAX(fp.flood_depth_cm)::float AS flood_depth_cm
        FROM flood_predictions fp
        WHERE fp.time >= now() AND fp.time < now() + interval '${h} hours'
          ${whereFp}
        GROUP BY 1, 2 ORDER BY 1 ASC LIMIT ${h};
      `
    }
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

  async getCurrentFloodRiskCounts(hours, isGlobal, predictionNodeIds) {
    const h = Number(hours) || 24

    if (isGlobal) {
      const sql = `
        SELECT
          CASE
            WHEN flood_depth_cm <= 10 THEN 'safe'
            WHEN flood_depth_cm <= 20 THEN 'medium'
            WHEN flood_depth_cm <= 40 THEN 'high'
            ELSE 'severe'
          END AS risk_level,
          COUNT(*)::int AS count
        FROM mv_latest_flood_predictions
        GROUP BY 1;
      `
      return this.sequelize.query(sql, { type: QueryTypes.SELECT })
    }

    // Filtered mode — JOIN qua node_id (không cần location_name trên fp)
    let whereFp = `AND fp.node_id IN (${predictionNodeIds.join(',')})`
    const sql = `
      WITH latest AS (
        SELECT DISTINCT ON (fp.node_id) fp.node_id, fp.flood_depth_cm
        FROM flood_predictions fp
        WHERE fp.time >= now() - interval '${h} hours'
        ${whereFp}
        ORDER BY fp.node_id, fp.time DESC
      )
      SELECT
        CASE
          WHEN flood_depth_cm <= 10 THEN 'safe'
          WHEN flood_depth_cm <= 20 THEN 'medium'
          WHEN flood_depth_cm <= 40 THEN 'high'
          ELSE 'severe'
        END AS risk_level,
        COUNT(*)::int AS count
      FROM latest
      GROUP BY 1;
    `
    return this.sequelize.query(sql, { type: QueryTypes.SELECT })
  }

  async getRepresentativeNodeIds() {
    if (!this.representativeNodes) {
      const rows = await this.sequelize.query(`
        SELECT DISTINCT ON (weather_station_id) node_id
        FROM grid_nodes
        WHERE weather_station_id IS NOT NULL;
      `, { type: QueryTypes.SELECT })
      this.representativeNodes = rows.map((r) => r.node_id).join(',')
    }
    return this.representativeNodes
  }

  async getTempHumidity(weatherNodeIds, isGlobal, hours) {
    const tz = 'Asia/Ho_Chi_Minh'
    const h = Number(hours) || 72
    const nodesStr = isGlobal ? await this.getRepresentativeNodeIds() : weatherNodeIds.join(',')
    let whereWm = `AND wm.node_id IN (${nodesStr})`

    const sql = `
      SELECT
        date_trunc('hour', (wm.time AT TIME ZONE :tz)) AS real_time,
        to_char(date_trunc('hour', (wm.time AT TIME ZONE :tz)), 'DD/MM HH24:MI') AS time,
        COALESCE(AVG(wm.temp), 0)::float AS temp,
        COALESCE(AVG(wm.rhum), 0)::float AS rhum
      FROM weather_measurements wm
      WHERE wm.time >= now() AND wm.time < now() + interval '${h} hours'
        ${whereWm}
      GROUP BY 1, 2 ORDER BY 1 ASC LIMIT ${h};
    `
    return this.sequelize.query(sql, { type: QueryTypes.SELECT, replacements: { tz } })
  }

  async getRiskTrend(predictionNodeIds, isGlobal, hours) {
    const tz = 'Asia/Ho_Chi_Minh'
    const h = Number(hours) || 168
    const bucket = h <= 48 ? 'hour' : 'day'
    const fmt    = h <= 48 ? 'DD/MM HH24:00' : 'DD/MM'

    if (isGlobal) {
      let hourFilter = ''
      if (h > 48) {
        hourFilter = `AND extract(hour from bucket_time AT TIME ZONE :tz) = 12`
      }
      
      const sql = `
        SELECT
          to_char(bucket_time AT TIME ZONE :tz, :fmt) AS date,
          risk_level,
          count
        FROM mv_global_risk_trend
        WHERE bucket_time >= now() - interval '${h} hours'
        ${hourFilter}
        ORDER BY bucket_time ASC;
      `
      return this.sequelize.query(sql, { type: QueryTypes.SELECT, replacements: { tz, fmt } })
    }

    // Filtered: JOIN qua node_id
    let whereFp = `AND fp.node_id IN (${predictionNodeIds.join(',')})`

    if (bucket === 'hour') {
      const sql = `
        SELECT
          to_char(date_trunc('hour', (fp.time AT TIME ZONE :tz)), :fmt) AS date,
          CASE
            WHEN fp.flood_depth_cm <= 10 THEN 'safe'
            WHEN fp.flood_depth_cm <= 20 THEN 'medium'
            WHEN fp.flood_depth_cm <= 40 THEN 'high'
            ELSE 'severe'
          END AS risk_level,
          COUNT(*)::int AS count
        FROM flood_predictions fp
        WHERE fp.time >= now() - interval '${h} hours'
          ${whereFp}
        GROUP BY 1, 2
        ORDER BY 1, 2;
      `
      return this.sequelize.query(sql, { type: QueryTypes.SELECT, replacements: { tz, fmt } })
    }

    const sql = `
      WITH max_per_bucket AS (
        SELECT
          to_char(date_trunc('${bucket}', (fp.time AT TIME ZONE :tz)), :fmt) AS date,
          fp.node_id,
          MAX(fp.flood_depth_cm) as max_depth
        FROM flood_predictions fp
        WHERE fp.time >= now() - interval '${h} hours'
          ${whereFp}
        GROUP BY 1, 2
      )
      SELECT
        date,
        CASE
          WHEN max_depth <= 10 THEN 'safe'
          WHEN max_depth <= 20 THEN 'medium'
          WHEN max_depth <= 40 THEN 'high'
          ELSE 'severe'
        END AS risk_level,
        COUNT(*)::int AS count
      FROM max_per_bucket
      GROUP BY 1, 2
      ORDER BY 1, 2;
    `
    return this.sequelize.query(sql, { type: QueryTypes.SELECT, replacements: { tz, fmt } })
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
