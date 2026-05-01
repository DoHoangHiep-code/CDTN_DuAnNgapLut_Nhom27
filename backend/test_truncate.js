const { sequelize } = require('./src/db/sequelize');

async function testTruncate() {
  try {
    await sequelize.query('SET default_transaction_read_only = off;');
    await sequelize.query('TRUNCATE weather_measurements CASCADE;');
    await sequelize.query('TRUNCATE flood_predictions CASCADE;');
    console.log('TRUNCATE_SUCCESS');
  } catch (err) {
    console.error('TRUNCATE_FAILED:', err.message);
  } finally {
    process.exit();
  }
}

testTruncate();
