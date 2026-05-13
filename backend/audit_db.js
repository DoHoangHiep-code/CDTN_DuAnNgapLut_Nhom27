require('dotenv').config()
const { sequelize } = require('./src/db/sequelize')
const { QueryTypes } = require('sequelize')

async function audit() {
  console.log('\n=== 1. DATA VOLUME ===')
  const wm = await sequelize.query('SELECT COUNT(*) c, MIN(time::date) mn, MAX(time::date) mx FROM weather_measurements;', {type:QueryTypes.SELECT})
  const fp = await sequelize.query('SELECT COUNT(*) c, MIN(time::date) mn, MAX(time::date) mx FROM flood_predictions;', {type:QueryTypes.SELECT})
  console.log('weather_measurements:', wm[0].c, 'rows | date range:', wm[0].mn, '->', wm[0].mx)
  console.log('flood_predictions   :', fp[0].c, 'rows | date range:', fp[0].mn, '->', fp[0].mx)

  const wmt = await sequelize.query(
    'SELECT COUNT(DISTINCT time) distinct_times, COUNT(DISTINCT node_id) distinct_nodes FROM weather_measurements;',
    {type:QueryTypes.SELECT}
  )
  console.log('weather_measurements distinct times:', wmt[0].distinct_times, '| distinct nodes:', wmt[0].distinct_nodes)

  console.log('\n=== 2. location_name IN WHICH TABLES ===')
  const tabs = await sequelize.query(
    "SELECT table_name, column_name FROM information_schema.columns WHERE column_name = 'location_name' AND table_schema = 'public' ORDER BY table_name;",
    {type:QueryTypes.SELECT}
  )
  tabs.forEach(t => console.log(' ', t.table_name + '.' + t.column_name))

  // Sample location_name mismatch giữa weather_measurements vs grid_nodes
  const wmLocSample = await sequelize.query(
    "SELECT wm.node_id, wm.location_name wm_loc, gn.location_name gn_loc FROM weather_measurements wm JOIN grid_nodes gn ON wm.node_id = gn.node_id LIMIT 5;",
    {type:QueryTypes.SELECT}
  )
  console.log('\nSample location_name match (wm vs gn):')
  wmLocSample.forEach(r => console.log('  node', r.node_id, '| wm:', r.wm_loc, '| gn:', r.gn_loc))

  console.log('\n=== 3. district COLUMN ===')
  const distCol = await sequelize.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='grid_nodes' AND column_name='district';",
    {type:QueryTypes.SELECT}
  )
  if (distCol.length) {
    const distStats = await sequelize.query(
      'SELECT COUNT(*) total, COUNT(district) not_null, COUNT(*)-COUNT(district) null_count FROM grid_nodes;',
      {type:QueryTypes.SELECT}
    )
    console.log('district column exists:', distCol[0].data_type)
    console.log('  total:', distStats[0].total, '| not_null:', distStats[0].not_null, '| NULL:', distStats[0].null_count)
  } else {
    console.log('district column DOES NOT EXIST in grid_nodes')
  }

  console.log('\n=== 4. ALL COLUMNS OF grid_nodes ===')
  const cols = await sequelize.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='grid_nodes' AND table_schema='public' ORDER BY ordinal_position;",
    {type:QueryTypes.SELECT}
  )
  cols.forEach(c => console.log(' ', c.column_name, '(' + c.data_type + ')'))

  console.log('\n=== 5. FOREIGN KEY RELATIONSHIPS ===')
  const fks = await sequelize.query(`
    SELECT
      tc.table_name AS from_table,
      kcu.column_name AS from_col,
      ccu.table_name AS to_table,
      ccu.column_name AS to_col,
      tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
    JOIN information_schema.key_column_usage ccu
      ON rc.unique_constraint_name = ccu.constraint_name AND rc.unique_constraint_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
    ORDER BY tc.table_name;
  `, {type:QueryTypes.SELECT})
  fks.forEach(f => console.log('  ' + f.from_table + '.' + f.from_col + ' → ' + f.to_table + '.' + f.to_col))
  if (!fks.length) console.log('  (no FK constraints found in information_schema)')

  console.log('\n=== 6. INDEXES ===')
  const idx = await sequelize.query(`
    SELECT tablename, indexname, indexdef FROM pg_indexes
    WHERE schemaname='public' ORDER BY tablename, indexname;
  `, {type:QueryTypes.SELECT})
  idx.forEach(i => console.log('  [' + i.tablename + '] ' + i.indexname))

  await sequelize.close()
}
audit().catch(e => { console.error('ERR:', e.message); process.exit(1) })
