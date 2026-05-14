'use strict'

const express = require('express')
const { QueryTypes } = require('sequelize')
const { sequelize } = require('../db/sequelize')

const router = express.Router()

const KEY_DISTRICTS = ['Cầu Giấy', 'Hoàn Kiếm', 'Đống Đa', 'Ba Đình', 'Hai Bà Trưng']

// ── GET /api/v1/alerts/banner ─────────────────────────────────────────────────
router.get('/alerts/banner', async (req, res, next) => {
  try {
    // Build named placeholders cho IN clause
    const replacements = {}
    KEY_DISTRICTS.forEach((d, i) => { replacements[`d${i}`] = d })
    const districtList = KEY_DISTRICTS.map((_, i) => `:d${i}`).join(', ')

    // ── Query flood predictions (24h để có đủ data) ──────────────────────────
    // Dùng DISTINCT ON theo district_name, lấy bản ghi mới nhất
    const fpSql = `
      SELECT DISTINCT ON (gn.district_name)
        gn.district_name,
        fp.flood_depth_cm,
        fp.risk_level,
        fp.time AS pred_time
      FROM flood_predictions fp
      JOIN grid_nodes gn ON gn.node_id = fp.node_id
      WHERE gn.district_name IN (${districtList})
        AND fp.time >= NOW() - INTERVAL '24 hours'
      ORDER BY gn.district_name, fp.time DESC;
    `

    // ── Query weather (mở rộng 6h để fallback khi cron chạy thưa) ───────────
    // LEFT JOIN để đảm bảo không bỏ sót quận nào có trong grid_nodes
    const wxSql = `
      SELECT DISTINCT ON (gn.district_name)
        gn.district_name,
        COALESCE(wm.prcp,   0)::float AS rain_1h,
        COALESCE(wm.clouds, 0)::int   AS clouds_pct,
        COALESCE(wm.temp,  30)::float AS temp,
        COALESCE(wm.rhum,  70)::float AS rhum
      FROM grid_nodes gn
      LEFT JOIN weather_measurements wm ON wm.node_id = gn.node_id
        AND wm.time >= NOW() - INTERVAL '6 hours'
      WHERE gn.district_name IN (${districtList})
      ORDER BY gn.district_name, wm.time DESC NULLS LAST;
    `

    const [fpRows, wxRows] = await Promise.all([
      sequelize.query(fpSql, { type: QueryTypes.SELECT, replacements }).catch(() => []),
      sequelize.query(wxSql, { type: QueryTypes.SELECT, replacements }).catch(() => []),
    ])

    const byFp = new Map(fpRows.map(r => [r.district_name, r]))
    const byWx = new Map(wxRows.map(r => [r.district_name, r]))

    const data = KEY_DISTRICTS.map(name => {
      const fp = byFp.get(name)
      const wx = byWx.get(name)
      return {
        district:     name,
        floodDepthCm: fp ? (Math.round(Number(fp.flood_depth_cm) * 10) / 10) : 0,
        riskLevel:    fp?.risk_level || 'safe',
        rain1h:       wx ? (Math.round(Number(wx.rain_1h) * 10) / 10) : 0,
        cloudsPct:    wx ? (Number(wx.clouds_pct) || 0) : 0,
        temp:         wx ? (Math.round(Number(wx.temp) * 10) / 10) : 30,
        humidity:     wx ? (Math.round(Number(wx.rhum))) : 70,
        predTime:     fp?.pred_time ? new Date(fp.pred_time).toISOString() : null,
        hasData:      !!(fp || wx),
      }
    })

    return res.status(200).json({ success: true, updatedAt: new Date().toISOString(), data })
  } catch (err) {
    return next(err)
  }
})

module.exports = { alertsRouter: router }
