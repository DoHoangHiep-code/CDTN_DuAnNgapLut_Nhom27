const { QueryTypes } = require('sequelize')

class MapRepository {
  /**
   * @param {{sequelize: import('sequelize').Sequelize}} deps
   */
  constructor({ sequelize }) {
    this.sequelize = sequelize
  }

  async _withStatementTimeout(ms, fn) {
    return this.sequelize.transaction(async (t) => {
      await this.sequelize.query(`SET LOCAL statement_timeout = ${Number(ms) | 0};`, { transaction: t })
      return fn(t)
    })
  }

  /**
   * Returns a GeoJSON FeatureCollection for CURRENT local hour (Asia/Ho_Chi_Minh).
   * GeoJSON is built in SQL (no JS mapping).
   */
  async getCurrentFloodMapFeatureCollection() {
    const tz = 'Asia/Ho_Chi_Minh'
    const sql = `
      WITH bounds AS (
        SELECT
          (date_trunc('hour', now() AT TIME ZONE :tz) AT TIME ZONE :tz) AS start_ts,
          ((date_trunc('hour', now() AT TIME ZONE :tz) + interval '1 hour') AT TIME ZONE :tz) AS end_ts
      ),
      features AS (
        SELECT json_build_object(
          'type', 'Feature',
          'geometry', ST_AsGeoJSON(gn.geom)::jsonb,
          'properties', json_build_object(
            'prediction_id', fp.prediction_id,
            'flood_depth_cm', fp.flood_depth_cm,
            'risk_level', fp.risk_level
          )
        ) AS feature
        FROM flood_predictions fp
        JOIN grid_nodes gn ON gn.node_id = fp.node_id
        CROSS JOIN bounds b
        WHERE fp.time >= b.start_ts AND fp.time < b.end_ts
      )
      SELECT json_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
      ) AS geojson
      FROM features;
    `

    return this._withStatementTimeout(10000, (t) =>
      this.sequelize.query(sql, {
        type: QueryTypes.SELECT,
        replacements: { tz },
        transaction: t,
      }).then((rows) => rows?.[0]?.geojson ?? { type: 'FeatureCollection', features: [] }),
    )
  }
}

module.exports = { MapRepository }

