const { sequelize } = require('./src/db/sequelize');
sequelize.query("SELECT pg_size_pretty(pg_database_size(current_database())) as size;").then(res => console.log('DB_SIZE:', res[0])).catch(console.error).finally(()=>process.exit());
