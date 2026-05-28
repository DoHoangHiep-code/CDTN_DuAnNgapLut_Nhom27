'use strict'

// Tọa độ trung tâm Hà Nội – dùng làm default khi dashboard không truyền lat/lng
const HANOI_LAT = 21.0285
const HANOI_LON = 105.8542

class WeatherController {
  /**
   * @param {{weatherService: any}} deps
   */
  constructor({ weatherService }) {
    this.weatherService = weatherService
    this.getWeather = this.getWeather.bind(this)
  }

  async getWeather(req, res, next) {
    try {
      const latRaw   = req.query.lat
      const lngRaw   = req.query.lng
      const district = typeof req.query.district === 'string' ? req.query.district : undefined

      const lat = latRaw != null ? Number(latRaw) : HANOI_LAT
      const lng = lngRaw != null ? Number(lngRaw) : HANOI_LON
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return res.status(400).json({ success: false, error: { message: 'Invalid lat/lng' } })
      }

      // ── Chỉ dùng dữ liệu từ Database (Local) ──────────────────────────────
      const raw = await this.weatherService.getWeatherByLatLng({ lat, lng }).catch(() => null)

      if (raw && raw.current) {
        const current = {
          temperatureC:    raw.current?.temperature  ?? 0,
          humidityPct:     raw.current?.humidity     ?? 0,
          windKph:         raw.current?.windSpeed    ?? 0,
          rainfallMm:      raw.current?.prcp         ?? 0,
          cloudsPct:       raw.current?.clouds       ?? 0,
          rainIntensityMm: raw.current?.prcp         ?? 0,
          observedAtIso:   raw.current?.time         ?? new Date().toISOString(),
          locationName:    district || raw.locationName || `Node #${raw.nodeId ?? '-'}`,
        }

        // Lấy 24h forecast từ repo
        const forecast24hRaw = await this.weatherService.weatherRepository.getHourlyForecast24h(raw.stationId).catch(() => [])
        
        // Tạo window 24h: 12h quá khứ -> 11h tương lai (chính giữa là giờ hiện tại)
        const nowMs = Date.now()
        const utcHourMs = nowMs - (nowMs % 3600000)
        const baseTime = utcHourMs - 12 * 3600000

        const forecast24h = []
        for (let i = 0; i < 24; i++) {
          const targetTime = new Date(baseTime + i * 3600000)
          
          // Tìm record gần nhất trong raw data (dung sai 30 phút)
          let matched = null
          let minDiff = Infinity
          for (const r of forecast24hRaw) {
            const diff = Math.abs(new Date(r.time).getTime() - targetTime.getTime())
            if (diff < 3600000 && diff < minDiff) {
              minDiff = diff
              matched = r
            }
          }

          if (matched) {
            forecast24h.push({
              timeIso:    targetTime.toISOString(),
              rainfallMm: Math.round(Number(matched.prcp) * 10) / 10,
              tempC:      Math.round(Number(matched.temp) * 10) / 10,
              humidity:   Math.round(Number(matched.rhum)),
              cloudsPct:  Number(matched.clouds) || 0,
            })
          } else {
            // Padding nếu DB thiếu
            forecast24h.push({
              timeIso:    targetTime.toISOString(),
              rainfallMm: 0,
              tempC:      current.temperatureC || 28,
              humidity:   current.humidityPct || 70,
              cloudsPct:  0,
            })
          }
        }

        const forecast7d = Array.isArray(raw.forecast7d)
          ? raw.forecast7d.map(d => ({
              dateIso:    new Date(d.date).toISOString().slice(0, 10),
              minTempC:   d.minTemp    ?? 0,
              maxTempC:   d.maxTemp    ?? 0,
              rainfallMm: d.totalRain  ?? 0,
              humidityPct: 0,
            }))
          : []

        return res.status(200).json({
          success: true,
          source:  'database',
          data: {
            current,
            forecast24h,
            forecast3d:  forecast7d.slice(0, 3),
            forecast7d,
          },
        })
      }

      // ── Nếu DB không có data thì fallback về Demo ─────────
      const { buildWeather } = require('../../../utils/demoData')
      return res.status(200).json({
        success: true,
        source:  'demo',
        data:    buildWeather(district),
      })
    } catch (err) {
      return next(err)
    }
  }
}

module.exports = { WeatherController }
