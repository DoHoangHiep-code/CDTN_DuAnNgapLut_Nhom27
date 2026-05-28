'use strict'

class LandslideService {
  constructor({ sequelize }) {
    this.sequelize = sequelize
  }

  // TODO: Triển khai nghiệp vụ phân tích nguy cơ sạt lở tại đây
  async getRiskZones() {
    throw new Error('Not implemented yet')
  }
}

module.exports = { LandslideService }
