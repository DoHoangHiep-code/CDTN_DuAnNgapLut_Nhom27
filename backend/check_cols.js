const { sequelize } = require('./src/db/sequelize');
sequelize.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'grid_nodes'").then(r => {
  console.log('grid_nodes columns:', r[0].map(c => c.column_name));
}).catch(e => console.error(e.message)).finally(() => process.exit(0));
