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
      console.error('[DashboardController] Error:', err)
      const message = err instanceof Error ? err.message : 'Unknown error'
      return res.status(500).json({ success: false, error: { message } })
    }
  }

  async getAutocomplete(req, res) {
    try {
      const search = String(req.query.q || '').trim()
      const data = await this.dashboardService.getAutocomplete(search)
      return res.status(200).json({ success: true, data })
    } catch (err) {
      console.error('[DashboardController] Error in autocomplete:', err)
      const message = err instanceof Error ? err.message : 'Unknown error'
      return res.status(500).json({ success: false, error: { message } })
    }
  }
}

module.exports = { DashboardController }

