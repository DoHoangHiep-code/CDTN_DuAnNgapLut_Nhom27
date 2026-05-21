'use strict'

class LandslideController {
  constructor({ landslideService }) {
    this.landslideService = landslideService
    this.getRiskZones = this.getRiskZones.bind(this)
  }

  async getRiskZones(_req, res, next) {
    try {
      const data = await this.landslideService.getRiskZones()
      return res.status(200).json({ success: true, data })
    } catch (err) {
      return next(err)
    }
  }
}

module.exports = { LandslideController }
