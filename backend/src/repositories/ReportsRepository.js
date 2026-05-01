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

  // GET danh sách báo cáo thực tế, có phân trang (page/limit)
  async listActualFloodReports({ page = 1, limit = 50 } = {}) {
    const safeLimit  = Math.min(Math.max(parseInt(limit)  || 50,  1), 200)
    const safePage   = Math.max(parseInt(page) || 1, 1)
    const offset     = (safePage - 1) * safeLimit

    const sql = `
      SELECT
        afr.report_id,
        afr.created_at,
        afr.latitude,
        afr.longitude,
        afr.reported_level,
        afr.user_id,
        u.full_name AS user_full_name,
        COUNT(*) OVER() AS total_count
      FROM actual_flood_reports afr
      LEFT JOIN users u ON u.user_id = afr.user_id
      ORDER BY afr.created_at DESC
      LIMIT :limit OFFSET :offset;
    `
    const rows = await this._withStatementTimeout(5000, (t) =>
      this.sequelize.query(sql, {
        type: QueryTypes.SELECT,
        replacements: { limit: safeLimit, offset },
        transaction: t,
      }),
    )
    const total = rows.length > 0 ? Number(rows[0].total_count) : 0
    return {
      rows,
      pagination: { page: safePage, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit) },
    }
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

