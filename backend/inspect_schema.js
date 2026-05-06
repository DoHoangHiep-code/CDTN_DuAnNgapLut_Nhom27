const { sequelize } = require('./src/db/sequelize')
;(async () => {
  const [cols] = await sequelize.query(`
    SELECT column_name, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'grid_nodes'
    ORDER BY ordinal_position
  `)
  cols.forEach(c => console.log(c.column_name.padEnd(22), '|', c.column_default?.slice(0,50) ?? 'NULL', '| nullable:', c.is_nullable))
  process.exit(0)
})()
