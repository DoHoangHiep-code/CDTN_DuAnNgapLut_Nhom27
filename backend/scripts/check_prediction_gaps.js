'use strict'

/**
 * Script: Verificar gaps entre weather_measurements e flood_predictions
 * 
 * Uso: node check_prediction_gaps.js
 * 
 * Mostra:
 * - Total de weather records
 * - Total de prediction records
 * - Número de (node_id, time) gaps
 * - Amostra dos gaps encontrados
 */

require('dotenv').config()
const { sequelize } = require('../src/db/sequelize')

async function main() {
  try {
    console.log('🔍 Verificando gaps entre weather_measurements e flood_predictions...\n')

    // 1. Total de weather records
    const weatherCount = await sequelize.query(
      `SELECT COUNT(*) as cnt FROM weather_measurements`,
      { type: sequelize.QueryTypes.SELECT }
    )
    console.log(`📊 Total weather records: ${weatherCount[0].cnt}`)

    // 2. Total de prediction records
    const predictionCount = await sequelize.query(
      `SELECT COUNT(*) as cnt FROM flood_predictions`,
      { type: sequelize.QueryTypes.SELECT }
    )
    console.log(`📊 Total prediction records: ${predictionCount[0].cnt}\n`)

    // 3. Contar gaps: weather que não tem prediction correspondente
    const gaps = await sequelize.query(
      `SELECT COUNT(DISTINCT (w.node_id, w.time)) as gap_count
       FROM weather_measurements w
       LEFT JOIN flood_predictions fp ON w.node_id = fp.node_id AND w.time = fp.time
       WHERE fp.prediction_id IS NULL`,
      { type: sequelize.QueryTypes.SELECT }
    )
    console.log(`❌ Records com gap (weather sem prediction): ${gaps[0].gap_count}`)

    // 4. Mostrar amostra dos gaps
    console.log('\n📋 Amostra dos 10 primeiros gaps:\n')
    const sampleGaps = await sequelize.query(
      `SELECT 
         w.node_id,
         w.time,
         gn.location_name,
         COUNT(*) as weather_count
       FROM weather_measurements w
       LEFT JOIN grid_nodes gn ON w.node_id = gn.node_id
       LEFT JOIN flood_predictions fp ON w.node_id = fp.node_id AND w.time = fp.time
       WHERE fp.prediction_id IS NULL
       GROUP BY w.node_id, w.time, gn.location_name
       LIMIT 10`,
      { type: sequelize.QueryTypes.SELECT }
    )

    sampleGaps.forEach((row, i) => {
      console.log(`${i + 1}. Node ${row.node_id} (${row.location_name}) @ ${row.time}`)
    })

    // 5. Estatísticas por data
    console.log('\n\n📅 Gaps por data:\n')
    const gapsByDate = await sequelize.query(
      `SELECT 
         DATE(w.time) as date,
         COUNT(DISTINCT (w.node_id, w.time)) as gap_count
       FROM weather_measurements w
       LEFT JOIN flood_predictions fp ON w.node_id = fp.node_id AND w.time = fp.time
       WHERE fp.prediction_id IS NULL
       GROUP BY DATE(w.time)
       ORDER BY date DESC
       LIMIT 10`,
      { type: sequelize.QueryTypes.SELECT }
    )

    gapsByDate.forEach((row) => {
      console.log(`  ${row.date}: ${row.gap_count} gaps`)
    })

    // 6. Mostrar nodes com mais gaps
    console.log('\n\n🔴 Top 10 nodes com mais gaps:\n')
    const nodeGaps = await sequelize.query(
      `SELECT 
         w.node_id,
         gn.location_name,
         COUNT(DISTINCT w.time) as gap_count
       FROM weather_measurements w
       LEFT JOIN grid_nodes gn ON w.node_id = gn.node_id
       LEFT JOIN flood_predictions fp ON w.node_id = fp.node_id AND w.time = fp.time
       WHERE fp.prediction_id IS NULL
       GROUP BY w.node_id, gn.location_name
       ORDER BY gap_count DESC
       LIMIT 10`,
      { type: sequelize.QueryTypes.SELECT }
    )

    nodeGaps.forEach((row) => {
      console.log(`  Node ${row.node_id} (${row.location_name}): ${row.gap_count} gaps`)
    })

    console.log('\n✅ Verificação concluída!\n')
  } catch (err) {
    console.error('❌ Erro:', err.message)
  } finally {
    await sequelize.close()
  }
}

main()
