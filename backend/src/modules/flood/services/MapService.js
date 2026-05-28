class MapService {
  /**
   * @param {{mapRepository: any}} deps
   */
  constructor({ mapRepository }) {
    this.mapRepository = mapRepository
  }

  async getFloodMapGeoJson() {
    return this.mapRepository.getCurrentFloodMapFeatureCollection()
  }
}

module.exports = { MapService }

