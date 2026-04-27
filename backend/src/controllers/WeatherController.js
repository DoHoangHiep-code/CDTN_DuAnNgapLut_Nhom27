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
      const latRaw = req.query.lat
      const lngRaw = req.query.lng
      const district = typeof req.query.district === 'string' ? req.query.district : undefined

      const lat = latRaw != null ? Number(latRaw) : HANOI_LAT
      const lng = lngRaw != null ? Number(lngRaw) : HANOI_LON
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return res.status(400).json({ success: false, error: { message: 'Invalid lat/lng' } })
      }

      // Thử lấy thời tiết thực tế từ OpenWeatherMap trước
      const { getWeatherByCoords } = require('../services/OpenWeatherService')
      const owm = await getWeatherByCoords(lat, lng).catch(() => null)

      if (owm) {
        // Có dữ liệu OWM thật → trả luôn, không cần query DB
        const current = {
          temperatureC: Math.round(owm.temp * 10) / 10,
          humidityPct: owm.humidity,
          windKph: Math.round(owm.windSpeed * 3.6 * 10) / 10, // m/s → km/h
          rainfallMm: owm.rain1h,
          observedAtIso: new Date().toISOString(),
          locationName: district || 'Hà Nội',
        }
        // forecast24h/3d/7d dùng demo pattern nhưng lấy base từ dữ liệu OWM thật
        const now = new Date()
        const forecast24h = Array.from({ length: 24 }, (_, i) => {
          const t = new Date(now.getTime() + i * 3600 * 1000)
          const hour = t.getHours()
          const rainFactor = hour >= 14 && hour <= 20 ? 1.8 : 0.5
          return {
            timeIso: t.toISOString(),
            rainfallMm: Math.round(Math.max(0, owm.rain1h * rainFactor + Math.sin(i) * 1.5) * 10) / 10,
          }
        })
        const forecast3d = Array.from({ length: 3 }, (_, i) => {
          const d = new Date(now.getTime() + (i + 1) * 86400 * 1000)
          return {
            dateIso: d.toISOString().slice(0, 10),
            minTempC: Math.round((owm.temp - 3 + i * 0.3) * 10) / 10,
            maxTempC: Math.round((owm.temp + 4 + i * 0.3) * 10) / 10,
            rainfallMm: Math.round((owm.rain1h * 8 + i * 2) * 10) / 10,
            humidityPct: Math.min(95, owm.humidity + i * 2),
          }
        })
        return res.status(200).json({
          success: true,
          data: { current, forecast24h, forecast3d, forecast7d: forecast3d },
        })
      }

      // OWM không khả dụng (chưa có API key hoặc lỗi mạng) → thử DB
      const raw = await this.weatherService.getWeatherByLatLng({ lat, lng }).catch(() => null)

      if (raw?.current) {
        const current = {
          temperatureC: raw.current?.temperature ?? 0,
          humidityPct: raw.current?.humidity ?? 0,
          windKph: raw.current?.windSpeed ?? 0,
          rainfallMm: raw.current?.prcp ?? 0,
          observedAtIso: raw.current?.time ?? new Date().toISOString(),
          locationName: district || `Node #${raw.nodeId ?? '-'}`,
        }
        const forecast7d = Array.isArray(raw.forecast7d)
          ? raw.forecast7d.map((d) => ({
            dateIso: String(d.date).slice(0, 10),
            minTempC: d.minTemp ?? 0,
            maxTempC: d.maxTemp ?? 0,
            rainfallMm: d.totalRain ?? 0,
            humidityPct: 0,
          }))
          : []
        return res.status(200).json({
          success: true,
          data: { current, forecast24h: [], forecast3d: forecast7d.slice(0, 3), forecast7d },
        })
      }

      // Cuối cùng mới fallback demo (khi cả OWM lẫn DB đều không có dữ liệu)
      const { buildWeather } = require('../utils/demoData')
      return res.status(200).json({ success: true, data: buildWeather(district) })
    } catch (err) {
      return next(err)
    }
  }
}

module.exports = { WeatherController }

