'use strict'

/**
 * Script: Fill missing predictions
 * 
 * Uso: node fill_missing_predictions.js [--limit=100] [--node-id=123] [--date=2026-05-01]
 * 
 * Cria predictions para todos os weather records que não têm prediction correspondente
 * - Busca features do weather
 * - Chama AI para cada gap
 * - Salva em flood_predictions
 */

require('dotenv').config()
const axios = require('axios')
const { sequelize } = require('../src/db/sequelize')

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000'
const AI_TIMEOUT_MS = 5000
const DEFAULT_LIMIT = 100

// Parse argumentos
const args = process.argv.slice(2)
let limit = DEFAULT_LIMIT
let nodeIdFilter = null
let dateFilter = null
let batchMode = false

args.forEach(arg => {
  if (arg.startsWith('--limit=')) limit = parseInt(arg.split('=')[1]) || DEFAULT_LIMIT
  if (arg.startsWith('--node-id=')) nodeIdFilter = parseInt(arg.split('=')[1])
  if (arg.startsWith('--date=')) dateFilter = arg.split('=')[1]
  if (arg === '--batch') batchMode = true
})

function buildFeatures(row) {
  const t = new Date(row.time)
  const hour = t.getHours()
  const month = t.getMonth() + 1
  const dayofweek = t.getDay() === 0 ? 6 : t.getDay() - 1
  const start = new Date(t.getFullYear(), 0, 0)
  const dayofyear = Math.floor((t - start) / 86400000)
  const rainyMonths = [5, 6, 7, 8, 9, 10]

  return {
    prcp: Number(row.prcp) || 0,
    prcp_3h: Number(row.prcp_3h) || 0,
    prcp_6h: Number(row.prcp_6h) || 0,
    prcp_12h: Number(row.prcp_12h) || 0,
    prcp_24h: Number(row.prcp_24h) || 0,
    temp: Number(row.temp) || 28,
    rhum: Number(row.rhum) || 70,
    wspd: Number(row.wspd) || 0,
    pres: Number(row.pres) || 1010,
    pressure_change_24h: Number(row.pressure_change_24h) || 0,
    max_prcp_3h: Number(row.max_prcp_3h) || 0,
    max_prcp_6h: Number(row.max_prcp_6h) || 0,
    max_prcp_12h: Number(row.max_prcp_12h) || 0,
    elevation: Number(row.elevation) || 5,
    slope: Number(row.slope) || 1,
    impervious_ratio: Number(row.impervious_ratio) || 0.5,
    dist_to_drain_km: Number(row.dist_to_drain_km) || 0.5,
    dist_to_river_km: Number(row.dist_to_river_km) || 1.0,
    dist_to_pump_km: Number(row.dist_to_pump_km) || 1.0,
    dist_to_main_road_km: Number(row.dist_to_main_road_km) || 0.3,
    dist_to_park_km: Number(row.dist_to_park_km) || 0.5,
    hour,
    dayofweek,
    month,
    dayofyear,
    hour_sin: Math.sin((2 * Math.PI * hour) / 24),
    hour_cos: Math.cos((2 * Math.PI * hour) / 24),
    month_sin: Math.sin((2 * Math.PI * month) / 12),
    month_cos: Math.cos((2 * Math.PI * month) / 12),
    rainy_season_flag: rainyMonths.includes(month) ? 1 : 0,
  }
}

async function callAI(features) {
  try {
    const res = await axios.post(`${AI_SERVICE_URL}/api/predict`, features, {
      timeout: AI_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' },
    })
    return res.data
  } catch (err) {
    console.error(`  ⚠️  AI error: ${err.message}`)
    return null
  }
}

async function callAIBatch(featuresArray) {
  try {
    const res = await axios.post(`${AI_SERVICE_URL}/api/predict/batch`, featuresArray, {
      timeout: AI_TIMEOUT_MS * 3,
      headers: { 'Content-Type': 'application/json' },
    })
    return res.data
  } catch (err) {
    console.error(`  ⚠️  AI batch error: ${err.message}`)
    return null
  }
}

async function savePrediction(nodeId, time, floodDepthCm, riskLevel) {
  try {
    await sequelize.query(
      `INSERT INTO flood_predictions (node_id, time, flood_depth_cm, risk_level)
       VALUES (:nodeId, :time, :depth, :risk)
       ON CONFLICT (node_id, time) DO UPDATE SET
         flood_depth_cm = EXCLUDED.flood_depth_cm,
         risk_level = EXCLUDED.risk_level`,
      {
        replacements: {
          nodeId,
          time,
          depth: floodDepthCm,
          risk: riskLevel,
        },
      }
    )
    return true
  } catch (err) {
    console.error(`  ❌ Save error: ${err.message}`)
    return false
  }
}

async function main() {
  try {
    console.log(`\n🔄 Fill missing predictions`)
    console.log(`Parameters: limit=${limit}, nodeId=${nodeIdFilter}, date=${dateFilter}, batch=${batchMode}\n`)

    // 1. Encontrar gaps
    let whereClause = 'WHERE fp.prediction_id IS NULL'
    const replacements = {}

    if (nodeIdFilter) {
      whereClause += ' AND w.node_id = :nodeId'
      replacements.nodeId = nodeIdFilter
    }

    if (dateFilter) {
      whereClause += ' AND DATE(w.time) = :dateFilter'
      replacements.dateFilter = dateFilter
    }

    const gapQuery = `
      SELECT DISTINCT
        w.node_id,
        w.time,
        w.temp,
        w.rhum,
        w.prcp,
        w.prcp_3h,
        w.prcp_6h,
        w.prcp_12h,
        w.prcp_24h,
        w.wspd,
        w.pres,
        w.pressure_change_24h,
        w.max_prcp_3h,
        w.max_prcp_6h,
        w.max_prcp_12h,
        gn.elevation,
        gn.slope,
        gn.impervious_ratio,
        gn.dist_to_drain_km,
        gn.dist_to_river_km,
        gn.dist_to_pump_km,
        gn.dist_to_main_road_km,
        gn.dist_to_park_km,
        gn.location_name
      FROM weather_measurements w
      LEFT JOIN grid_nodes gn ON w.node_id = gn.node_id
      LEFT JOIN flood_predictions fp ON w.node_id = fp.node_id AND w.time = fp.time
      ${whereClause}
      ORDER BY w.time DESC, w.node_id
      LIMIT :limit
    `

    replacements.limit = limit

    const gaps = await sequelize.query(gapQuery, {
      replacements,
      type: sequelize.QueryTypes.SELECT,
    })

    console.log(`📊 Encontrados ${gaps.length} gaps para processar\n`)

    if (gaps.length === 0) {
      console.log('✅ Nenhum gap encontrado!')
      return
    }

    // 2. Processar em batch ou individual
    let processed = 0
    let success = 0

    if (batchMode && gaps.length > 1) {
      console.log(`📦 Processando em batch mode (${gaps.length} registros)...`)
      const featuresArray = gaps.map(row => buildFeatures(row))
      const results = await callAIBatch(featuresArray)

      if (results && Array.isArray(results)) {
        for (let i = 0; i < gaps.length; i++) {
          const row = gaps[i]
          const result = results[i]

          if (result && result.flood_depth_cm !== undefined && result.risk_level) {
            const saved = await savePrediction(
              row.node_id,
              row.time,
              result.flood_depth_cm,
              result.risk_level
            )
            if (saved) success++
          }
          processed++
          if (processed % 10 === 0) {
            console.log(`  ⏳ Processados: ${processed}/${gaps.length}`)
          }
        }
      }
    } else {
      console.log(`🔄 Processando individual (${gaps.length} registros)...`)
      for (let i = 0; i < gaps.length; i++) {
        const row = gaps[i]
        const features = buildFeatures(row)
        const result = await callAI(features)

        if (result && result.flood_depth_cm !== undefined && result.risk_level) {
          const saved = await savePrediction(
            row.node_id,
            row.time,
            result.flood_depth_cm,
            result.risk_level
          )
          if (saved) success++
        }

        processed++
        if (processed % 5 === 0) {
          console.log(`  ⏳ Processados: ${processed}/${gaps.length}`)
        }
      }
    }

    console.log(`\n✅ Resultado: ${success}/${processed} predictions criadas com sucesso!\n`)
  } catch (err) {
    console.error('❌ Erro fatal:', err.message)
    console.error(err)
  } finally {
    await sequelize.close()
  }
}

main()
