'use strict'
require('dotenv').config()
const { sequelize, QueryTypes } = require('./src/db/sequelize')
const { DashboardRepository } = require('./src/repositories/DashboardRepository')

async function testAll() {
  const repo = new DashboardRepository({ sequelize })
  const weatherNodeIds = [] // global
  const predictionNodeIds = [] // global
  const isGlobal = true
  const h = 24

  console.time('getCurrentWeather')
  await repo.getCurrentWeather(weatherNodeIds, isGlobal)
  console.timeEnd('getCurrentWeather')

  console.time('getRainForecast')
  await repo.getRainForecast(weatherNodeIds, isGlobal, predictionNodeIds, h)
  console.timeEnd('getRainForecast')

  console.time('getCurrentFloodRiskCounts')
  await repo.getCurrentFloodRiskCounts(h, isGlobal, predictionNodeIds)
  console.timeEnd('getCurrentFloodRiskCounts')

  console.time('getRecentAlerts')
  await repo.getRecentAlerts(10)
  console.timeEnd('getRecentAlerts')

  console.time('getTempHumidity')
  await repo.getTempHumidity(weatherNodeIds, isGlobal, h)
  console.timeEnd('getTempHumidity')

  console.time('getRiskTrend')
  await repo.getRiskTrend(predictionNodeIds, isGlobal, 24)
  console.timeEnd('getRiskTrend')
}

testAll().catch(console.error).finally(() => sequelize.close())
