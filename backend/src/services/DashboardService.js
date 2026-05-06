const NodeCache = require('node-cache')

class DashboardService {
  /**
   * @param {{dashboardRepository: any}} deps
   */
  constructor({ dashboardRepository }) {
    this.dashboardRepository = dashboardRepository
    this.cache = new NodeCache({ stdTTL: 300, checkperiod: 60, useClones: false })
    this.cacheKey = 'dashboard:v1'
  }

  _overallFromCounts(counts) {
    const severe = counts.severe || 0
    const high = counts.high || 0
    if (severe > 0) return 'severe'
    if (high > 0) return 'high'
    if ((counts.medium || 0) > 0) return 'medium'
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

  async getDashboard() {
    const cached = this.cache.get(this.cacheKey)
    if (cached) return cached

    const [weatherRow, rainRows, riskRows, alertRows, tempHumRows, riskTrendRows] = await Promise.all([
      this.dashboardRepository.getCurrentWeather().catch(() => null),
      this.dashboardRepository.getRainForecast24h().catch(() => []),
      this.dashboardRepository.getCurrentFloodRiskCounts().catch(() => []),
      this.dashboardRepository.getRecentAlerts(10).catch(() => []),
      this.dashboardRepository.getTempHumidity24h().catch(() => []),
      this.dashboardRepository.getRiskTrend7d().catch(() => []),
    ])

    const currentWeather = {
      temperature: Number(weatherRow?.temperature) || 0,
      humidity: Number(weatherRow?.humidity) || 0,
      windSpeed: Number(weatherRow?.wind_speed) || 0,
    }

    // Trả forecast24h theo yêu cầu tooltip dashboard:
    // - time: "HH:mm"
    // - prcp: lượng mưa (mm)
    // - flood_depth_cm: độ ngập dự đoán (cm)
    const forecast24h = Array.isArray(rainRows)
      ? rainRows.map((r) => ({
          time: String(r.time),
          prcp: Number(r.prcp) || 0,
          flood_depth_cm: Number(r.flood_depth_cm) || 0,
        }))
      : []

    const riskCounts = this._normalizeRiskCounts(riskRows)
    const overall = this._overallFromCounts(riskCounts)

    const alerts = Array.isArray(alertRows)
      ? alertRows.map((a) => ({
          id: a.report_id,
          type: 'actual_flood_report',
          message: `Báo cáo thực tế: ${a.reported_level}`,
          createdAt: a.created_at,
          latitude: Number(a.latitude),
          longitude: Number(a.longitude),
          level: a.reported_level,
        }))
      : []

    // temp + rhum 24h — mỗi bucket là 1 giờ
    const tempHumidity24h = Array.isArray(tempHumRows)
      ? tempHumRows.map((r) => ({
          time: String(r.time),
          temp: Number(r.temp) || 0,
          rhum: Number(r.rhum) || 0,
        }))
      : []

    // risk trend 7 ngày: gom thành mảng { date, safe, medium, high, severe }
    const riskTrendMap = new Map()
    for (const r of (riskTrendRows || [])) {
      if (!riskTrendMap.has(r.date)) {
        riskTrendMap.set(r.date, { date: r.date, safe: 0, medium: 0, high: 0, severe: 0 })
      }
      const entry = riskTrendMap.get(r.date)
      if (r.risk_level && Object.prototype.hasOwnProperty.call(entry, r.risk_level)) {
        entry[r.risk_level] = Number(r.count) || 0
      }
    }
    const riskTrend7d = Array.from(riskTrendMap.values()).sort((a, b) => a.date.localeCompare(b.date))

    const payload = {
      alerts,
      currentWeather,
      rainForecast: forecast24h.map((p) => ({ time: p.time, value: p.prcp })),
      forecast24h,
      tempHumidity24h,
      riskTrend7d,
      riskSummary: { ...riskCounts, overall },
    }

    this.cache.set(this.cacheKey, payload, 300)
    return payload
  }
}

module.exports = { DashboardService }

