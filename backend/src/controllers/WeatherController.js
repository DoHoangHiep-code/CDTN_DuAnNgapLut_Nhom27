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

      // Nếu không truyền tọa độ, mặc định sử dụng tọa độ trung tâm Hà Nội
      // Cách này giúp API tương thích với nhánh main và tránh lỗi 400 (Bad Request) trên Frontend
      const HANOI_LAT = 21.0285
      const HANOI_LON = 105.8542

      const lat = latRaw != null ? Number(latRaw) : HANOI_LAT
      const lng = lngRaw != null ? Number(lngRaw) : HANOI_LON
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return res.status(400).json({ success: false, error: { message: 'Invalid lat/lng' } })
      }

      const raw = await this.weatherService.getWeatherByLatLng({ lat, lng })

      // Chuẩn hoá response theo đúng shape frontend đang dùng (WeatherResponse)
      // Lý do: UI hiện render current.temperatureC, forecast24h/forecast3d/forecast7d.
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
            humidityPct: 0, // Backend timeseries hiện chưa aggregate humidity theo ngày; để 0 để UI không crash
          }))
        : []

      // FE dashboard chart cần forecast24h/forecast3d; nếu chưa có dữ liệu thật thì trả [] an toàn.
      const data = { current, forecast24h: [], forecast3d: forecast7d.slice(0, 3), forecast7d }
      return res.status(200).json({ success: true, data })
    } catch (err) {
      return next(err)
    }
  }
}

module.exports = { WeatherController }

