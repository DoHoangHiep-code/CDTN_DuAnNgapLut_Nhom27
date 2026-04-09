class MapController {
  /**
   * @param {{mapService: any}} deps
   */
  constructor({ mapService }) {
    this.mapService = mapService
    this.getFloodMaps = this.getFloodMaps.bind(this)
  }

  async getFloodMaps(_req, res, next) {
    try {
      const geojson = await this.mapService.getFloodMapGeoJson()
      return res.status(200).json({ success: true, data: geojson })
    } catch (err) {
      return next(err)
    }
  }
}

module.exports = { MapController }

