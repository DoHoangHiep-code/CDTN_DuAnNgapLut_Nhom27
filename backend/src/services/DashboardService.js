'use strict'

const NodeCache = require('node-cache')

class DashboardService {
  constructor({ dashboardRepository }) {
    this.dashboardRepository = dashboardRepository
    // Cache ngắn hơn (60s) khi có filter — chỉ cache default query 5 phút
    this.cache = new NodeCache({ stdTTL: 60, checkperiod: 30, useClones: false })
  }

  _cacheKey(hours, search) {
    return `dashboard:h${hours}:s${(search || '').toLowerCase().trim()}`
  }

  _overallFromCounts(counts) {
    if (counts.severe > 0) return 'severe'
    if (counts.high   > 0) return 'high'
    if (counts.medium > 0) return 'medium'
    return 'safe'
  }

  _normalizeRiskCounts(rows) {
    const out = { safe: 0, medium: 0, high: 0, severe: 0 }
    for (const r of rows || []) {
      const k = r.risk_level
      if (k && Object.prototype.hasOwnProperty.call(out, k)) out[k] = Number(r.count) || 0
    }
    return out
  }

  _normalizeRiskTrend(rows) {
    const map = new Map()
    for (const r of rows || []) {
      if (!map.has(r.date)) map.set(r.date, { date: r.date, safe: 0, medium: 0, high: 0, severe: 0 })
      const entry = map.get(r.date)
      if (r.risk_level && Object.prototype.hasOwnProperty.call(entry, r.risk_level)) {
        entry[r.risk_level] = Number(r.count) || 0
      }
    }
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
  }

  async getDashboard({ hours = 24, search = '' } = {}) {
    const h = Math.min(Math.max(Number(hours) || 24, 1), 168) // clamp 1–168h
    const key = this._cacheKey(h, search)
    const cached = this.cache.get(key)
    if (cached) return cached

    // 1. Resolve node_id list từ search term
    const nodes = await this.dashboardRepository.resolveNodes(search).catch(() => null)

    // 2. Parallel fetch tất cả data
    const [weatherRow, rainRows, riskRows, alertRows, tempHumRows, riskTrendRows] = await Promise.all([
      this.dashboardRepository.getCurrentWeather(nodes).catch(() => null),
      this.dashboardRepository.getRainForecast(nodes, h).catch(() => []),
      this.dashboardRepository.getCurrentFloodRiskCounts(h).catch(() => []),
      this.dashboardRepository.getRecentAlerts(10).catch(() => []),
      this.dashboardRepository.getTempHumidity(nodes, h).catch(() => []),
      this.dashboardRepository.getRiskTrend(nodes, h <= 48 ? h : 168).catch(() => []),
    ])

    const currentWeather = {
      temperature: Number(weatherRow?.temperature) || 0,
      humidity:    Number(weatherRow?.humidity)    || 0,
      windSpeed:   Number(weatherRow?.wind_speed)  || 0,
    }

    const forecast24h = (rainRows || []).map((r) => ({
      time:          String(r.time),
      prcp:          Number(r.prcp) || 0,
      flood_depth_cm: Number(r.flood_depth_cm) || 0,
    }))

    const riskCounts = this._normalizeRiskCounts(riskRows)
    const overall    = this._overallFromCounts(riskCounts)

    const alerts = (alertRows || []).map((a) => ({
      id:        a.report_id,
      type:      'actual_flood_report',
      message:   `Báo cáo thực tế: ${a.reported_level}`,
      createdAt: a.created_at,
      latitude:  Number(a.latitude),
      longitude: Number(a.longitude),
      level:     a.reported_level,
    }))

    const tempHumidity24h = (tempHumRows || []).map((r) => ({
      time: String(r.time),
      temp: Number(r.temp) || 0,
      rhum: Number(r.rhum) || 0,
    }))

    const riskTrend7d = this._normalizeRiskTrend(riskTrendRows)

    // resolvedNodes: trả về danh sách trạm thực sự đang được hiển thị
    const resolvedNodes = Array.isArray(nodes)
      ? await this._getNodeLabels(nodes).catch(() => [])
      : []

    const payload = {
      alerts,
      currentWeather,
      forecast24h,
      tempHumidity24h,
      riskTrend7d,
      riskSummary: { ...riskCounts, overall },
      meta: { hours: h, search: search || '', resolvedNodes },
    }

    const ttl = search ? 60 : 300
    this.cache.set(key, payload, ttl)
    return payload
  }

  async _getNodeLabels(nodeIds) {
    const rows = await this.dashboardRepository.sequelize.query(
      `SELECT node_id, location_name FROM grid_nodes WHERE node_id IN (${nodeIds.join(',')}) ORDER BY node_id`,
      { type: 'SELECT' },
    )
    return rows.map((r) => ({ id: Number(r.node_id), name: r.location_name }))
  }
}

module.exports = { DashboardService }
