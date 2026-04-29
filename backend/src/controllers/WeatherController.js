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

      const { getWeatherByCoords, getOWMForecast5d } = require('../services/OpenWeatherService')

      // Lấy thời tiết hiện tại và forecast 5 ngày song song từ OWM
      const [owm, owmForecast] = await Promise.all([
        getWeatherByCoords(lat, lng).catch(() => null),
        getOWMForecast5d(lat, lng).catch(() => null),
      ])

      if (owm) {
        // ── Có dữ liệu OWM thật ──────────────────────────────────────────────
        const current = {
          temperatureC:  Math.round(owm.temp * 10) / 10,
          humidityPct:   owm.humidity,
          windKph:       Math.round(owm.windSpeed * 3.6 * 10) / 10, // m/s → km/h
          rainfallMm:    owm.rain1h,
          observedAtIso: new Date().toISOString(),
          locationName:  district || 'Hà Nội',
        }

        // forecast24h: Lấy 8 data points đầu từ OWM forecast (8 × 3h = 24h)
        // Mỗi point là 1 khoảng 3h — hiển thị đủ 24h tiếp theo
        let forecast24h = []
        if (owmForecast && owmForecast.length) {
          forecast24h = owmForecast.slice(0, 8).map(p => ({
            timeIso:    new Date(p.timeUtc).toISOString(),
            rainfallMm: Math.round(p.rain3h * 10) / 10,
            tempC:      Math.round(p.temp * 10) / 10,
            humidity:   p.humidity,
          }))
        }

        // forecast3d: Aggregate 3 ngày đầu từ OWM forecast
        let forecast3d = []
        if (owmForecast && owmForecast.length) {
          const { aggregateToDaily } = require('../services/OpenWeatherService')
          const daily = aggregateToDaily(owmForecast, 3)
          forecast3d = daily.map(d => ({
            dateIso:    d.dateIso,
            minTempC:   d.minTempC,
            maxTempC:   d.maxTempC,
            rainfallMm: d.rainfallMm,
            humidityPct: d.humidityPct,
          }))
        }

        // forecast7d: Aggregate 5 ngày từ OWM forecast rồi pad thêm 2 ngày
        let forecast7d = []
        if (owmForecast && owmForecast.length) {
          const { aggregateToDaily } = require('../services/OpenWeatherService')
          const daily = aggregateToDaily(owmForecast, 5)
          forecast7d = daily.map(d => ({
            dateIso:    d.dateIso,
            minTempC:   d.minTempC,
            maxTempC:   d.maxTempC,
            rainfallMm: d.rainfallMm,
            humidityPct: d.humidityPct,
          }))

          // Pad to 7 days
          while (forecast7d.length > 0 && forecast7d.length < 7) {
            const last = forecast7d[forecast7d.length - 1]
            const nextDate = new Date(last.dateIso)
            nextDate.setDate(nextDate.getDate() + 1)
            forecast7d.push({
              ...last,
              dateIso: nextDate.toISOString().slice(0, 10),
            })
          }
        }

        return res.status(200).json({
          success: true,
          source:  'openweathermap',
          data: {
            current,
            forecast24h,
            forecast3d,
            forecast7d,
          },
        })
      }

      // ── OWM không khả dụng → thử DB ─────────────────────────────────────────
      const raw = await this.weatherService.getWeatherByLatLng({ lat, lng }).catch(() => null)

      if (raw?.current) {
        const current = {
          temperatureC:  raw.current?.temperature  ?? 0,
          humidityPct:   raw.current?.humidity     ?? 0,
          windKph:       raw.current?.windSpeed    ?? 0,
          rainfallMm:    raw.current?.prcp         ?? 0,
          observedAtIso: raw.current?.time         ?? new Date().toISOString(),
          locationName:  district || `Node #${raw.nodeId ?? '-'}`,
        }
        const forecast7d = Array.isArray(raw.forecast7d)
          ? raw.forecast7d.map(d => ({
              dateIso:    String(d.date).slice(0, 10),
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
            forecast24h: [],
            forecast3d:  forecast7d.slice(0, 3),
            forecast7d,
          },
        })
      }

      // ── Cuối cùng mới fallback demo (khi cả OWM lẫn DB đều không có) ─────────
      const { buildWeather } = require('../utils/demoData')
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
