class WeatherService {
  /**
   * @param {{weatherRepository: any}} deps
   */
  constructor({ weatherRepository }) {
    this.weatherRepository = weatherRepository
  }

  async getWeatherByLatLng({ lat, lng }) {
    const nodeId = await this.weatherRepository.findNearestNodeId({ lat, lng })
    if (!nodeId) {
      return {
        nodeId: null,
        current: { temperature: 0, humidity: 0, windSpeed: 0, prcp: 0, time: null },
        forecast7d: [],
      }
    }

    const [currentRow, forecastRows] = await Promise.all([
      this.weatherRepository.getLatestWeatherByNodeId(nodeId).catch(() => null),
      this.weatherRepository.get7DayForecastByNodeId(nodeId).catch(() => []),
    ])

    const current = {
      temperature: Number(currentRow?.temp) || 0,
      humidity: Number(currentRow?.rhum) || 0,
      windSpeed: Number(currentRow?.wspd) || 0,
      prcp: Number(currentRow?.prcp) || 0,
      time: currentRow?.time ?? null,
    }

    const forecast7d = Array.isArray(forecastRows)
      ? forecastRows.map((r) => ({
          date: r.date,
          minTemp: Number(r.minTemp) || 0,
          maxTemp: Number(r.maxTemp) || 0,
          totalRain: Number(r.totalRain) || 0,
        }))
      : []

    return { nodeId, current, forecast7d }
  }
}

module.exports = { WeatherService }

