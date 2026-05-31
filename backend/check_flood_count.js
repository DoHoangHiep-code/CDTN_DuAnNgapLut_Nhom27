const { sequelize } = require('./src/db/sequelize');

async function countFloodPoints() {
  try {
    const [results] = await sequelize.query(`
      SELECT count(*) 
      FROM flood_predictions
      WHERE time >= date_trunc('hour', NOW()) 
        AND time < date_trunc('hour', NOW()) + INTERVAL '1 hour'
        AND flood_depth_cm > 10
    `);
    console.log('Count from flood_predictions (depth > 10) in current hour:', results);

    const [resultsAllTime] = await sequelize.query(`
      SELECT count(*) 
      FROM flood_predictions
      WHERE flood_depth_cm > 10
    `);
    console.log('Count from flood_predictions (depth > 10) all time:', resultsAllTime);

  } catch (e2) {
    console.log('Error with flood_predictions', e2.message);
  }
  process.exit();
}
countFloodPoints();
