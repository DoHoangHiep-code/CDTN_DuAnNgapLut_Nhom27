const { sequelize } = require('./src/db/sequelize')

async function checkTable(tableName) {
  const [cols] = await sequelize.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = '${tableName}'
  `)
  
  const results = {}
  const countQuery = await sequelize.query(`SELECT COUNT(*) as total FROM ${tableName}`)
  const total = Number(countQuery[0][0].total)
  results.total_rows = total
  
  if (total === 0) return results

  for (const col of cols) {
    const name = col.column_name
    const type = col.data_type.toLowerCase()
    
    // Check nulls
    const [nullQ] = await sequelize.query(`SELECT COUNT(*) as n FROM ${tableName} WHERE "${name}" IS NULL`)
    const nulls = Number(nullQ[0].n)
    
    // Check zeros for numeric fields
    let zeros = 0
    if ((type.includes('int') || type.includes('float') || type.includes('double') || type.includes('numeric') || type.includes('decimal')) && !type.includes('geometry') && type !== 'user-defined') {
      const [zeroQ] = await sequelize.query(`SELECT COUNT(*) as z FROM ${tableName} WHERE "${name}" = 0`)
      zeros = Number(zeroQ[0].z)
    }

    results[name] = { nulls, zeros, type }
  }
  return results
}

async function main() {
  const tables = ['grid_nodes', 'weather_stations', 'weather_measurements', 'flood_predictions']
  for (const t of tables) {
    console.log(`\n--- TABLE: ${t} ---`)
    try {
      const res = await checkTable(t)
      console.log(`Total rows: ${res.total_rows}`)
      for (const [k, v] of Object.entries(res)) {
        if (k === 'total_rows') continue
        if (v.nulls > 0 || v.zeros > 0) {
           console.log(`- ${k.padEnd(20)} | NULL: ${String(v.nulls).padEnd(6)} | ZERO: ${v.zeros}  (${v.type})`)
        }
      }
    } catch (e) {
      console.log(`Error checking table ${t}: ${e.message}`)
    }
  }
  process.exit(0)
}

main()
