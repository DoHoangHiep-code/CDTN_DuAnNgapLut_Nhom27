'use strict'
require('dotenv').config()
const { sequelize } = require('./src/db/sequelize')

async function deleteOldData() {
  console.log('Bắt đầu xóa dữ liệu cũ (đến hết ngày 09/05/2026)...')
  
  const targetDate = '2026-05-09 23:59:59'
  const CHUNK_SIZE = 100000;
  
  try {
    console.log('Đang xóa weather_measurements...')
    let rowsDeleted = 1;
    let totalWx = 0;
    while(rowsDeleted > 0) {
      const [res] = await sequelize.query(`
        DELETE FROM weather_measurements 
        WHERE measurement_id IN (
          SELECT measurement_id FROM weather_measurements 
          WHERE time <= :targetDate 
          LIMIT ${CHUNK_SIZE}
        );
      `, { replacements: { targetDate } })
      rowsDeleted = res.rowCount || 0;
      totalWx += rowsDeleted;
      console.log(`Đã xóa ${totalWx} dòng weather_measurements...`)
    }

    console.log('Đang xóa flood_predictions...')
    rowsDeleted = 1;
    let totalPreds = 0;
    while(rowsDeleted > 0) {
      const [res] = await sequelize.query(`
        DELETE FROM flood_predictions 
        WHERE prediction_id IN (
          SELECT prediction_id FROM flood_predictions 
          WHERE time <= :targetDate 
          LIMIT ${CHUNK_SIZE}
        );
      `, { replacements: { targetDate } })
      rowsDeleted = res.rowCount || 0;
      totalPreds += rowsDeleted;
      console.log(`Đã xóa ${totalPreds} dòng flood_predictions...`)
    }

    console.log(`\nHoàn thành!`)
  } catch (err) {
    console.error('Lỗi khi xóa:', err)
  } finally {
    await sequelize.close()
  }
}

deleteOldData()
