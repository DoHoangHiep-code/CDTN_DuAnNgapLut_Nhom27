require('dotenv').config();
const { sequelize } = require('./src/db/sequelize');
require('./src/models');

async function syncDb() {
  try {
    await sequelize.authenticate();
    console.log('[DB] Kết nối thành công.');
    
    await sequelize.query('CREATE EXTENSION IF NOT EXISTS postgis;');
    console.log('[DB] PostGIS sẵn sàng.');

    await sequelize.sync({ alter: true });
    console.log('[DB] Đồng bộ schema thành công.');
  } catch (error) {
    console.error('[DB] Lỗi đồng bộ:', error);
  } finally {
    process.exit();
  }
}

syncDb();
