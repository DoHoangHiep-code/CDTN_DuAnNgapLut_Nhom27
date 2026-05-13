'use strict'
require('dotenv').config()
const { sequelize } = require('./src/db/sequelize')

async function fastDelete() {
  console.log('Bắt đầu xóa dữ liệu siêu tốc bằng Index date_only...')
  const targetDateStr = '2026-05-09'
  const CHUNK_SIZE = 50000;
  
  try {
    let totalWx = 0;
    while(true) {
      const [countRes] = await sequelize.query(`SELECT COUNT(*) as c FROM weather_measurements WHERE date_only <= :targetDateStr`, { replacements: { targetDateStr } });
      if (Number(countRes[0].c) === 0) break;
      
      await sequelize.query(`
        DELETE FROM weather_measurements 
        WHERE measurement_id IN (
          SELECT measurement_id FROM weather_measurements 
          WHERE date_only <= :targetDateStr 
          LIMIT ${CHUNK_SIZE}
        );
      `, { replacements: { targetDateStr } })
      totalWx += CHUNK_SIZE;
      console.log(`[WX] Đã xóa ước tính ${totalWx} dòng... (còn lại ~${countRes[0].c})`)
    }

    let totalFp = 0;
    while(true) {
      const [countRes] = await sequelize.query(`SELECT COUNT(*) as c FROM flood_predictions WHERE date_only <= :targetDateStr`, { replacements: { targetDateStr } });
      if (Number(countRes[0].c) === 0) break;
      
      await sequelize.query(`
        DELETE FROM flood_predictions 
        WHERE prediction_id IN (
          SELECT prediction_id FROM flood_predictions 
          WHERE date_only <= :targetDateStr 
          LIMIT ${CHUNK_SIZE}
        );
      `, { replacements: { targetDateStr } })
      totalFp += CHUNK_SIZE;
      console.log(`[FP] Đã xóa ước tính ${totalFp} dòng... (còn lại ~${countRes[0].c})`)
    }
    console.log('\\nHoàn thành xóa siêu tốc!')
  } catch (e) {
    console.error(e)
  } finally {
    await sequelize.close()
  }
}
fastDelete()
