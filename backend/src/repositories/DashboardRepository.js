'use strict'

const { QueryTypes } = require('sequelize')

class DashboardRepository {
  constructor({ sequelize }) {
    this.sequelize = sequelize
  }

  /**
   * Autocomplete tìm kiếm địa điểm
   */
  async getLocationAutocomplete(search) {
    if (!search || !search.trim()) return []
    const rows = await this.sequelize.query(
      `SELECT DISTINCT location_name
       FROM grid_nodes
       WHERE location_name ILIKE :pattern AND location_name IS NOT NULL
       ORDER BY location_name LIMIT 10`,
      { type: QueryTypes.SELECT, replacements: { pattern: `%${search.trim()}%` } },
    )
    return rows.map((r, i) => ({
      node_id: i,
      location_name: r.location_name,
      district_name: '',
      weather_station_id: 0
    }))
  }

  /**
   * Trả về danh sách nodes dựa trên search.
   * Nếu search rỗng -> { isGlobal: true }
   * Nếu có search -> tìm node khớp
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

  async getCurrentWeather(weatherNodeIds, isGlobal) {
    const tz = 'Asia/Ho_Chi_Minh'
    const nodesStr = isGlobal ? await this.getRepresentativeNodeIds() : weatherNodeIds.join(',')
    let whereWm = `AND node_id IN (${nodesStr})`

    // Lấy thời điểm mới nhất trong bảng weather_measurements
    const sql = `
      WITH latest_time AS (
        SELECT MAX(time) AS max_time 
        FROM weather_measurements
        WHERE 1=1 ${whereWm}
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

  async getRainForecast(weatherNodeIds, isGlobal, predictionNodeIds, hours) {
    const tz = 'Asia/Ho_Chi_Minh'
    const h = Number(hours) || 24
    const nodesStr = isGlobal ? await this.getRepresentativeNodeIds() : weatherNodeIds.join(',')
    let whereWm = `AND node_id IN (${nodesStr})`
    let whereFp = isGlobal ? '' : `AND node_id IN (${predictionNodeIds.join(',')})`

    const sqlWm = `
      SELECT
        date_trunc('hour', (time AT TIME ZONE :tz)) AS real_time,
        to_char(date_trunc('hour', (time AT TIME ZONE :tz)), 'HH24:MI') AS time,
        MAX(prcp)::float AS prcp
      FROM weather_measurements
      WHERE time >= now() AND time < now() + interval '${h} hours'
        ${whereWm}
      GROUP BY 1, 2 ORDER BY 1 ASC LIMIT ${h};
    `
    let sqlFp
    if (isGlobal) {
      sqlFp = `
        SELECT
          bucket_time AS real_time,
          to_char(bucket_time AT TIME ZONE :tz, 'HH24:MI') AS time,
          avg_depth AS flood_depth_cm
        FROM mv_global_flood_avg
        WHERE bucket_time >= now() AND bucket_time < now() + interval '${h} hours'
        ORDER BY 1 ASC LIMIT ${h};
      `
    } else {
      sqlFp = `
        SELECT
          date_trunc('hour', (time AT TIME ZONE :tz)) AS real_time,
          to_char(date_trunc('hour', (time AT TIME ZONE :tz)), 'HH24:MI') AS time,
          MAX(flood_depth_cm)::float AS flood_depth_cm
        FROM flood_predictions
        WHERE time >= now() AND time < now() + interval '${h} hours'
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

    // Filtered mode
    let whereFp = `AND node_id IN (${predictionNodeIds.join(',')})`
    const sql = `
      WITH latest AS (
        SELECT DISTINCT ON (node_id) node_id, flood_depth_cm
        FROM flood_predictions
        WHERE time >= now() - interval '${h} hours'
        ${whereFp}
        ORDER BY node_id, time DESC
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
    const h = Number(hours) || 24
    const nodesStr = isGlobal ? await this.getRepresentativeNodeIds() : weatherNodeIds.join(',')
    let whereWm = `AND node_id IN (${nodesStr})`

    const sql = `
      SELECT
        date_trunc('hour', (time AT TIME ZONE :tz)) AS real_time,
        to_char(date_trunc('hour', (time AT TIME ZONE :tz)), 'HH24:MI') AS time,
        COALESCE(AVG(temp), 0)::float AS temp,
        COALESCE(AVG(rhum), 0)::float AS rhum
      FROM weather_measurements
      WHERE time >= now() AND time < now() + interval '${h} hours'
        ${whereWm}
      GROUP BY 1, 2 ORDER BY 1 ASC LIMIT ${h};
    `
    return this.sequelize.query(sql, { type: QueryTypes.SELECT, replacements: { tz } })
  }

  async getRiskTrend(predictionNodeIds, isGlobal, hours) {
    const tz = 'Asia/Ho_Chi_Minh'
    const h = Number(hours) || 168 // default 7 ngày
    const bucket = h <= 48 ? 'hour' : 'day'
    const fmt    = h <= 48 ? 'MM-DD HH24:00' : 'MM-DD'

    if (isGlobal) {
      // Global: Query cực nhanh từ Materialized View đã pre-aggregate
      // Nếu h <= 48 (hour): lấy mọi record
      // Nếu h > 48 (day): để biểu đồ bớt rậm rạp, có thể chỉ lấy các mốc 12h trưa làm đại diện,
      // hoặc lấy toàn bộ. Ở đây ta lấy toàn bộ (Chart.js tự scale), nhưng format ngày theo fmt.
      // Tuy nhiên nếu format MM-DD thì group by sẽ gộp các giờ lại?
      // Bản chất MV là đếm theo từng giờ. Nếu ta đổi label thành ngày, Chart sẽ hiện n điểm có cùng nhãn ngày.
      // Tốt nhất: nếu h > 48, lấy mốc 12h trưa.
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

    // Filtered: Query on-the-fly (dữ liệu nhỏ nên vẫn nhanh)
    let whereFp = `AND node_id IN (${predictionNodeIds.join(',')})`

    // Tối ưu: Nếu bucket là hour, vì mỗi node chỉ có 1 record 1 giờ, ta có thể bỏ subquery
    if (bucket === 'hour') {
      const sql = `
        SELECT
          to_char(date_trunc('hour', (time AT TIME ZONE :tz)), :fmt) AS date,
          CASE
            WHEN flood_depth_cm <= 10 THEN 'safe'
            WHEN flood_depth_cm <= 20 THEN 'medium'
            WHEN flood_depth_cm <= 40 THEN 'high'
            ELSE 'severe'
          END AS risk_level,
          COUNT(*)::int AS count
        FROM flood_predictions
        WHERE time >= now() - interval '${h} hours'
          ${whereFp}
        GROUP BY 1, 2
        ORDER BY 1, 2;
      `
      return this.sequelize.query(sql, { type: QueryTypes.SELECT, replacements: { tz, fmt } })
    }

    // Nếu bucket là day, bắt buộc phải dùng max_per_bucket để tìm max(depth) trong ngày của từng node
    const sql = `
      WITH max_per_bucket AS (
        SELECT
          to_char(date_trunc('${bucket}', (time AT TIME ZONE :tz)), :fmt) AS date,
          node_id,
          MAX(flood_depth_cm) as max_depth
        FROM flood_predictions
        WHERE time >= now() - interval '${h} hours'
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

