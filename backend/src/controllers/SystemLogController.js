const { SystemLog } = require('../models')

class SystemLogController {
  async list(req, res, next) {
    try {
      const limit = Math.min(Number(req.query.limit) || 100, 1000)
      const logs = await SystemLog.findAll({
        order: [['timestamp', 'DESC']],
        limit
      })
      
      return res.json({
        success: true,
        data: logs
      })
    } catch (err) {
      next(err)
    }
  }
}

module.exports = { SystemLogController }
