require('dotenv').config()
const { sequelize } = require('./src/db/sequelize')
const { QueryTypes } = require('sequelize')

async function go() {
  const [wm] = await sequelize.query('SELECT COUNT(*) c, MIN(time::date) mn, MAX(time::date) mx FROM weather_measurements;', {type:QueryTypes.SELECT})
  const [fp] = await sequelize.query('SELECT COUNT(*) c, MIN(time::date) mn, MAX(time::date) mx FROM flood_predictions;', {type:QueryTypes.SELECT})
  console.log('weather_measurements:', wm.c, 'rows |', wm.mn, '->', wm.mx)
  console.log('flood_predictions   :', fp.c, 'rows |', fp.mn, '->', fp.mx)
  await sequelize.close()
}
go().catch(e => { console.error(e.message); process.exit(1) })
