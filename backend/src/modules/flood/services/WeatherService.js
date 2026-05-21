class WeatherService {
  /**
   * @param {{weatherRepository: any}} deps
   */
  constructor({ weatherRepository }) {
    this.weatherRepository = weatherRepository
  }

  async getWeatherByLatLng({ lat, lng }) {
    const nearest = await this.weatherRepository.findNearestNode({ lat, lng })
    const nodeId = nearest ? nearest.original_node_id : null
    const stationId = nearest ? nearest.rep_node_id : null

    if (!nodeId || !stationId) {
      return {
        nodeId: null,
        current: { temperature: 0, humidity: 0, windSpeed: 0, prcp: 0, time: null },
        forecast7d: [],
      }
    }

    const [currentRow, forecastRows] = await Promise.all([
      this.weatherRepository.getLatestWeatherByNodeId(stationId).catch(() => null),
      this.weatherRepository.get7DayForecastByNodeId(stationId).catch(() => []),
    ])

    const current = {
      temperature: Number(currentRow?.temp)   || 0,
      humidity:    Number(currentRow?.rhum)   || 0,
      windSpeed:   Number(currentRow?.wspd)   || 0,
      prcp:        Number(currentRow?.prcp)   || 0,
      clouds:      Number(currentRow?.clouds) || 0,
      time:        currentRow?.time ?? null,
    }

    const forecast7d = Array.isArray(forecastRows)
      ? forecastRows.map((r) => ({
          date: r.date,
          minTemp: Number(r.minTemp) || 0,
          maxTemp: Number(r.maxTemp) || 0,
          totalRain: Number(r.totalRain) || 0,
        }))
      : []

    return { 
      nodeId, 
      stationId, 
      locationName: nearest?.location_name || nearest?.district_name || null,
      districtName: nearest?.district_name || null,
      current, 
      forecast7d 
    }
  }
}

module.exports = { WeatherService }

