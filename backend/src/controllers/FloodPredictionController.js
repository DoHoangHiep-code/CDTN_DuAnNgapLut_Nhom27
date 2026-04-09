const { buildFloodPrediction } = require('../utils/demoData') // Tạo dữ liệu demo tương thích UI

class FloodPredictionController {
  async getFloodPrediction(_req, res, next) {
    try {
      // Trả về payload demo để UI không bị 404 khi tắt mocks
      const data = buildFloodPrediction()
      return res.status(200).json({ success: true, data })
    } catch (err) {
      return next(err)
    }
  }
}

module.exports = { FloodPredictionController }

