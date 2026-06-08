const NodeCache = require('node-cache')

class MapService {
  /**
   * @param {{mapRepository: any}} deps
   */
  constructor({ mapRepository }) {
    this.mapRepository = mapRepository
    this.cache = new NodeCache({ stdTTL: 60, checkperiod: 30, useClones: false })
  }

  async getFloodMapGeoJson() {
    const key = 'map:geojson:current'
    const cached = this.cache.get(key)
    if (cached) return cached

    const data = await this.mapRepository.getCurrentFloodMapFeatureCollection()
    this.cache.set(key, data, 60) // Cache 1 minute since it takes a long time
    return data
  }
}

module.exports = { MapService }

