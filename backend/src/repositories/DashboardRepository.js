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
      `SELECT node_id FROM grid_nodes
       WHERE location_name = :pattern`,
      { type: QueryTypes.SELECT, replacements: { pattern: search.trim() } },
    )
    if (rows.length === 0) {
      return { isGlobal: true, predictionNodeIds: null, weatherNodeIds: null }
    }
    const predictionNodeIds = rows.map((r) => Number(r.node_id))

    // Tìm trạm thời tiết GẦN NHẤT với centroid của vùng tìm kiếm
    const nodeList = predictionNodeIds.join(',')
    const stationRows = await this.sequelize.query(`
      WITH loc_center AS (
        SELECT AVG(latitude)::float AS lat, AVG(longitude)::float AS lng
        FROM grid_nodes WHERE node_id IN (${nodeList})
      )
      SELECT gn.node_id::int AS weather_node_id
      FROM grid_nodes gn
      CROSS JOIN loc_center lc
      WHERE EXISTS (
        SELECT 1 FROM weather_measurements WHERE node_id = gn.node_id LIMIT 1
      )
      ORDER BY (gn.latitude::float - lc.lat)^2 + (gn.longitude::float - lc.lng)^2 ASC
      LIMIT 3
    `, { type: QueryTypes.SELECT })

    const weatherNodeIds = stationRows.map((r) => Number(r.weather_node_id))
    return { isGlobal: false, predictionNodeIds, weatherNodeIds }
  }

  /**
   * Thời tiết hiện tại — lấy bản ghi GẦN NHẤT với thời điểm hiện tại (không phải AVG 72h)
   */
  async getCurrentWeather(weatherNodeIds, isGlobal, hours) {
    const tz = 'Asia/Ho_Chi_Minh'
    const h = Number(hours) || 24
    const nodesStr = isGlobal ? await this.getRepresentativeNodeIds() : weatherNodeIds.join(',')
    let whereWm = `AND node_id IN (${nodesStr})`

    const sql = `
      SELECT
        AVG(temp)::float AS temp,
        AVG(rhum)::float AS rhum,
        MAX(prcp)::float AS prcp,
        AVG(wspd)::float AS wspd,
        now() AT TIME ZONE :tz AS last_update
      FROM weather_measurements
      WHERE time >= date_trunc('hour', now()) AND time < date_trunc('hour', now()) + interval '${h} hours'
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

    const timeMap = new Map()
    for (const r of wmRows) {
      timeMap.set(r.time, { time: r.time, real_time: new Date(r.real_time).getTime(), prcp: Number(r.prcp) || 0, flood_depth_cm: 0 })
    }
    for (const r of fpRows) {
      if (timeMap.has(r.time)) {
        timeMap.get(r.time).flood_depth_cm = Number(r.flood_depth_cm || r.avg_depth_cm) || 0
      } else {
        timeMap.set(r.time, { time: r.time, real_time: new Date(r.real_time).getTime(), prcp: 0, flood_depth_cm: Number(r.flood_depth_cm || r.avg_depth_cm) || 0 })
      }
    }

    return Array.from(timeMap.values()).sort((a, b) => a.real_time - b.real_time)
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

  /**
   * Cú pháp Bắc Cầu: Lấy gộp Thời tiết và Ngập lụt trực tiếp bằng JOIN location_name
   */
  async getLocationHourlyData(locationName, hours) {
    const tz = 'Asia/Ho_Chi_Minh'
    const h = Number(hours) || 24

    // Query 1: Dự báo ngập (JOIN grid_nodes)
    const sqlFp = `
      SELECT
        to_char(date_trunc('hour', (fp.time AT TIME ZONE :tz)), 'DD/MM HH24:MI') AS time,
        MAX(fp.flood_depth_cm)::float AS flood_depth_cm
      FROM flood_predictions fp
      JOIN grid_nodes gn ON fp.node_id = gn.node_id
      WHERE gn.location_name ILIKE :searchPattern
        AND fp.time >= now() AND fp.time < now() + interval '${h} hours'
      GROUP BY 1 ORDER BY 1 ASC
    `

    // Query 2: Thời tiết từ TRẠM GẦN NHẤT với địa điểm tìm kiếm
    // Dùng CTE tính centroid địa điểm → tìm 3 trạm gần nhất → lấy dữ liệu
    const sqlWm = `
      WITH loc_center AS (
        SELECT
          AVG(latitude)::float  AS lat,
          AVG(longitude)::float AS lng
        FROM grid_nodes
        WHERE location_name ILIKE :searchPattern
      ),
      nearest_stations AS (
        SELECT gn.node_id
        FROM grid_nodes gn
        CROSS JOIN loc_center lc
        WHERE EXISTS (
          SELECT 1 FROM weather_measurements WHERE node_id = gn.node_id LIMIT 1
        )
        ORDER BY (gn.latitude::float - lc.lat)^2 + (gn.longitude::float - lc.lng)^2 ASC
        LIMIT 3
      )
      SELECT
        to_char(date_trunc('hour', (wm.time AT TIME ZONE :tz)), 'DD/MM HH24:MI') AS time,
        COALESCE(AVG(wm.temp), 0)::float AS temp,
        COALESCE(AVG(wm.rhum), 0)::float AS rhum,
        COALESCE(MAX(wm.prcp), 0)::float AS prcp,
        COALESCE(AVG(wm.wspd), 0)::float AS wspd
      FROM weather_measurements wm
      JOIN nearest_stations ns ON wm.node_id = ns.node_id
      WHERE wm.time >= now() AND wm.time < now() + interval '${h} hours'
      GROUP BY 1 ORDER BY 1 ASC
    `

    const searchPattern = `%${locationName}%`

    const [fpRows, wmRows] = await Promise.all([
      this.sequelize.query(sqlFp, { type: QueryTypes.SELECT, replacements: { tz, searchPattern } }),
      this.sequelize.query(sqlWm, { type: QueryTypes.SELECT, replacements: { tz, searchPattern } }),
    ])

    const timeMap = new Map()
    for (const r of wmRows) {
      timeMap.set(r.time, { time: r.time, temp: r.temp, rhum: r.rhum, prcp: r.prcp, wspd: r.wspd, flood_depth_cm: 0 })
    }
    for (const r of fpRows) {
      if (timeMap.has(r.time)) {
        timeMap.get(r.time).flood_depth_cm = r.flood_depth_cm
      } else {
        timeMap.set(r.time, { time: r.time, temp: 0, rhum: 0, prcp: 0, wspd: 0, flood_depth_cm: r.flood_depth_cm })
      }
    }

    return Array.from(timeMap.values()).sort((a, b) => a.time.localeCompare(b.time))
  }

  async getRiskTrend(predictionNodeIds, isGlobal, hours) {
    const tz = 'Asia/Ho_Chi_Minh'
    const h = Number(hours) || 168
    const bucket = h <= 48 ? 'hour' : 'day'
    const fmt = h <= 48 ? 'DD/MM HH24:00' : 'DD/MM'

    if (isGlobal) {
      // Khi hiển thị theo ngày (h > 48): gộp tất cả bucket hourly trong mỗi ngày
      // bằng SUM thay vì lọc chính xác hour=12 (gây mất dữ liệu nếu MV không có bucket tại noon)
      const sql = h > 48
        ? `
          SELECT
            to_char(date_trunc('day', time AT TIME ZONE :tz), :fmt) AS date,
            risk_level,
            SUM(node_count)::int AS count
          FROM mv_global_risk_trend
          WHERE time >= now() - interval '24 hours'
            AND time <= now() + interval '${h} hours'
          GROUP BY 1, 2
          ORDER BY 1, 2;
        `
        : `
          SELECT
            to_char(time AT TIME ZONE :tz, :fmt) AS date,
            risk_level,
            node_count AS count
          FROM mv_global_risk_trend
          WHERE time >= now() - interval '24 hours'
            AND time <= now() + interval '${h} hours'
          ORDER BY time ASC;
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

  async getDynamicAlerts() {
    const tz = 'Asia/Ho_Chi_Minh'
    const sql = `
      SELECT DISTINCT ON (gn.district_name)
        gn.district_name AS district,
        fp.flood_depth_cm::float AS max_depth,
        to_char(fp.time AT TIME ZONE :tz, 'HH24:MI DD/MM') AS time
      FROM flood_predictions fp
      JOIN grid_nodes gn ON fp.node_id = gn.node_id
      WHERE fp.time >= now() AND fp.time <= now() + interval '24 hours'
        AND (fp.target = 1 OR fp.risk_level IN ('high', 'severe'))
        AND gn.district_name IS NOT NULL
      ORDER BY gn.district_name, fp.flood_depth_cm DESC
    `
    return this.sequelize.query(sql, { type: QueryTypes.SELECT, replacements: { tz } })
  }
}

module.exports = { DashboardRepository }
