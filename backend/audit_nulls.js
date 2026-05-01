const { sequelize } = require('./src/db/sequelize');

async function checkNulls() {
  const cols = [
    'temp','rhum','prcp','prcp_3h','prcp_6h','prcp_12h','prcp_24h',
    'wspd','wdir','pres','pressure_change_24h',
    'max_prcp_3h','max_prcp_6h','max_prcp_12h',
    'visibility_km','feels_like_c',
    'date_only','month','hour','rainy_season_flag','location_name'
  ];

  const [total] = await sequelize.query('SELECT COUNT(*) as cnt FROM weather_measurements;');
  const totalRows = parseInt(total[0].cnt);
  console.log(`\nTổng số dòng: ${totalRows}\n`);
  console.log('Cột\t\t\t\tNULL\t\tKhông NULL\t% NULL');
  console.log('─'.repeat(75));

  for (const col of cols) {
    const [res] = await sequelize.query(`SELECT COUNT(*) as cnt FROM weather_measurements WHERE ${col} IS NULL;`);
    const nullCount = parseInt(res[0].cnt);
    const pct = totalRows ? ((nullCount / totalRows) * 100).toFixed(1) : '0.0';
    const padded = col.padEnd(24);
    console.log(`${padded}\t${nullCount}\t\t${totalRows - nullCount}\t\t${pct}%`);
  }
  process.exit();
}

checkNulls().catch(e => { console.error(e); process.exit(1); });
