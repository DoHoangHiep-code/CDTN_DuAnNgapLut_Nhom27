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
    const safeLimit = Math.min(Math.max(parseInt(limit) || 50, 1), 200)
    const safePage  = Math.max(parseInt(page) || 1, 1)
    const offset    = (safePage - 1) * safeLimit
    const replacements = { limit: safeLimit, offset }

    // Build optional WHERE clauses
    const clauses = []

    // Filter theo location: tìm node gần nhất trong bán kính 5km rồi lấy reports trong bbox
    if (location && location.trim()) {
      clauses.push(`
        ST_DWithin(
          afr.geom::geography,
          (SELECT geom::geography FROM grid_nodes WHERE location_name ILIKE :locPattern OR district_name ILIKE :locPattern ORDER BY node_id LIMIT 1),
          5000
        )
      `)
      replacements.locPattern = `%${location.trim()}%`
    }

    if (dateFrom) {
      clauses.push(`afr.created_at >= :dateFrom`)
      replacements.dateFrom = new Date(dateFrom + 'T00:00:00+07:00').toISOString()
    }

    if (dateTo) {
      clauses.push(`afr.created_at <= :dateTo`)
      replacements.dateTo = new Date(dateTo + 'T23:59:59+07:00').toISOString()
    }

    const whereStr = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''

    const sql = `
      SELECT
        afr.report_id,
        afr.created_at,
        afr.latitude,
        afr.longitude,
        afr.reported_level,
        afr.user_id,
        u.full_name            AS user_full_name,
        -- De-normalize nearest node info to avoid slow reverse-geocode on FE
        (SELECT gn.location_name FROM grid_nodes gn
         ORDER BY ST_Distance(gn.geom::geography, afr.geom::geography) LIMIT 1) AS location_name,
        (SELECT gn.district_name FROM grid_nodes gn
         ORDER BY ST_Distance(gn.geom::geography, afr.geom::geography) LIMIT 1) AS district_name,
        COUNT(*) OVER() AS total_count
      FROM actual_flood_reports afr
      LEFT JOIN users u ON u.user_id = afr.user_id
      ${whereStr}
      ORDER BY afr.created_at DESC
      LIMIT :limit OFFSET :offset;
    `
    const rows = await this._withStatementTimeout(8000, (t) =>
      this.sequelize.query(sql, {
        type: QueryTypes.SELECT,
        replacements,
        transaction: t,
      }),
    )
    const total = rows.length > 0 ? Number(rows[0].total_count) : 0
    return {
      rows,
      pagination: { page: safePage, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit) },
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
  async createActualFloodReport({ userId, latitude, longitude, reported_level }) {
    const sql = `
      INSERT INTO actual_flood_reports (user_id, latitude, longitude, geom, reported_level, created_at)
      VALUES (
        :userId,
        :latitude,
        :longitude,
        ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326),
        :reported_level,
        NOW()
      )
      RETURNING report_id, created_at, latitude, longitude, reported_level, user_id;
    `
    return this._withStatementTimeout(7000, (t) =>
      this.sequelize.query(sql, {
        type: QueryTypes.SELECT,
        replacements: { userId, latitude, longitude, reported_level },
        transaction: t,
      }).then((rows) => rows?.[0] ?? null),
    )
  }
}

module.exports = { ReportsRepository }

