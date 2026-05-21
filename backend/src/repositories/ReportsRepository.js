const { QueryTypes } = require('sequelize') // Dùng QueryTypes để chạy raw SQL an toàn hơn (rõ intent)

class ReportsRepository {
  /**
   * @param {{sequelize: import('sequelize').Sequelize}} deps
   */
  constructor({ sequelize }) {
    this.sequelize = sequelize // Giữ instance sequelize để query
  }

  async _withStatementTimeout(ms, fn) {
    // Đặt statement_timeout để tránh query treo làm nghẽn DB (chống overload)
    return this.sequelize.transaction(async (t) => {
      await this.sequelize.query(`SET LOCAL statement_timeout = ${Number(ms) | 0};`, { transaction: t })
      return fn(t)
    })
  }

  // GET danh sách báo cáo thực tế, có phân trang + filter (location, dateFrom, dateTo)
  async listActualFloodReports({ page = 1, limit = 50, location, dateFrom, dateTo } = {}) {
    const { ActualFloodReport, GridNode, User } = require('../models')
    const { Op, Sequelize } = require('sequelize')

    const safeLimit = Math.min(Math.max(parseInt(limit) || 50, 1), 200)
    const safePage = Math.max(parseInt(page) || 1, 1)
    const offset = (safePage - 1) * safeLimit

    const where = {}

    if (location && location.trim()) {
      // Vì location có thể là chuỗi, ta vẫn có thể dùng ST_DWithin với geometry của grid_nodes
      // Tuy nhiên nếu dùng include GridNode, việc ST_DWithin từ node ra GridNode hơi vòng vèo.
      // Do yêu cầu dùng include, ta filter location_name qua GridNode.
      where['$GridNode.location_name$'] = { [Op.iLike]: `%${location.trim()}%` }
    }

    if (dateFrom || dateTo) {
      where.created_at = {}
      if (dateFrom) where.created_at[Op.gte] = new Date(dateFrom + 'T00:00:00+07:00')
      if (dateTo) where.created_at[Op.lte] = new Date(dateTo + 'T23:59:59+07:00')
    }

    const { count, rows } = await ActualFloodReport.findAndCountAll({
      where,
      limit: safeLimit,
      offset,
      order: [['created_at', 'DESC']],
      include: [
        {
          model: GridNode,
          attributes: ['location_name', 'district_name']
        },
        {
          model: User,
          attributes: ['full_name']
        }
      ]
    })

    return {
      rows: rows.map(r => r.toJSON()), // Chuyển thành plain object
      pagination: { page: safePage, limit: safeLimit, total: count, totalPages: Math.ceil(count / safeLimit) },
    }
  }

  // Autocomplete địa điểm từ grid_nodes (dùng cho Classic Filter)
  async searchLocations(q) {
    if (!q || !q.trim()) return []
    const sql = `
      SELECT DISTINCT district_name AS name, 'district' AS type
      FROM grid_nodes
      WHERE district_name ILIKE :pattern AND district_name IS NOT NULL
      UNION
      SELECT DISTINCT location_name AS name, 'node' AS type
      FROM grid_nodes
      WHERE location_name ILIKE :pattern AND location_name IS NOT NULL
      ORDER BY type, name
      LIMIT 12;
    `
    return this._withStatementTimeout(3000, (t) =>
      this.sequelize.query(sql, {
        type: QueryTypes.SELECT,
        replacements: { pattern: `%${q.trim()}%` },
        transaction: t,
      }),
    )
  }

  // POST tạo báo cáo mới: tạo geom bằng PostGIS từ lat/lng (không xử lý geometry bằng JSON)
  async createActualFloodReport({ userId, latitude, longitude, reported_level, node_id }) {
    const sql = `
      INSERT INTO actual_flood_reports (user_id, latitude, longitude, geom, reported_level, created_at, node_id)
      VALUES (
        :userId,
        :latitude,
        :longitude,
        ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326),
        :reported_level,
        NOW(),
        :node_id
      )
      RETURNING report_id, created_at, latitude, longitude, reported_level, user_id, node_id;
    `
    return this._withStatementTimeout(7000, (t) =>
      this.sequelize.query(sql, {
        type: QueryTypes.SELECT,
        replacements: { userId, latitude, longitude, reported_level, node_id },
        transaction: t,
      }).then((rows) => rows?.[0] ?? null),
    )
  }

  async getHotspots() {
    const tz = 'Asia/Ho_Chi_Minh'
    const query = `
      SELECT DISTINCT ON (gn.district_name)
        gn.district_name,
        gn.latitude,
        gn.longitude,
        wm.temp,
        wm.rhum,
        wm.prcp,
        COALESCE(fp.flood_depth_cm, 0) as flood_depth_cm
      FROM grid_nodes gn
      LEFT JOIN weather_measurements wm ON gn.st1_id = wm.node_id
        AND wm.time <= NOW() AND wm.time >= NOW() - interval '2 hours'
      LEFT JOIN flood_predictions fp ON gn.node_id = fp.node_id
        AND fp.time >= NOW() AND fp.time <= NOW() + interval '2 hours'
      WHERE gn.district_name IN ('Phường Cầu Giấy', 'Phường Hoàn Kiếm', 'Phường Đống Đa', 'Phường Hà Đông')
      ORDER BY gn.district_name, wm.time DESC, fp.time ASC
    `
    return this.sequelize.query(query, { type: QueryTypes.SELECT })
  }
}

module.exports = { ReportsRepository }

