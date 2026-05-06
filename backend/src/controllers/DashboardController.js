class DashboardController {
  /**
   * @param {{dashboardService: any}} deps
   */
  constructor({ dashboardService }) {
    this.dashboardService = dashboardService
    this.getDashboard = this.getDashboard.bind(this)
  }

  async getDashboard(req, res) {
    try {
      const hours  = Number(req.query.hours)  || 24
      const search = String(req.query.search  || '').trim()
      const data   = await this.dashboardService.getDashboard({ hours, search })
      return res.status(200).json({ success: true, data })
    } catch (err) {
      // In lỗi ra terminal để debug nhanh nguyên nhân 400/500 khi tích hợp frontend
      // (VD: DB timeout, thiếu extension, lỗi query...) - giúp bạn nhìn thấy ngay trên console backend
      // eslint-disable-next-line no-console
      console.error('[DashboardController] Error:', err)
      const message = err instanceof Error ? err.message : 'Unknown error'
      return res.status(500).json({ success: false, error: { message } })
    }
  }
}

module.exports = { DashboardController }

