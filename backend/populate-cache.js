/**
 * Script populate cache từ database
 * Chạy sau khi migration để cache được sẵn sàng ngay
 * 
 * Cách sử dụng:
 *   node populate-cache.js
 */

require('dotenv').config();
const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://s_:_rIigkJpJxIP9RJUS4OkTw@ninja-hacker-15200.jxf.gcp-asia-southeast1.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full';

const sslConfig = {
  rejectUnauthorized: false,
};

async function connectToDb() {
  try {
    const client = new Client({ 
      connectionString: DATABASE_URL,
      ssl: sslConfig,
    });
    await client.connect();
    console.log(`✓ Kết nối database thành công`);
    return client;
  } catch (error) {
    console.error(`✗ Lỗi kết nối database:`, error.message);
    throw error;
  }
}

async function populateFloodCache(client) {
  console.log('\n📊 Populate Flood Prediction Cache...');
  
  try {
    // 1) Top 10 worst areas (HIGH/SEVERE risk)
    const worstResult = await client.query(`
      SELECT 
        fp.node_id,
        fp.flood_depth_cm,
        fp.risk_level,
        gn.district_name,
        gn.latitude,
        gn.longitude,
        MAX(fp.time) as latest_time
      FROM flood_predictions fp
      LEFT JOIN grid_nodes gn ON gn.node_id = fp.node_id
      WHERE fp.time >= NOW() - INTERVAL '24 hours'
        AND fp.risk_level IN ('high', 'severe')
      GROUP BY fp.node_id, fp.flood_depth_cm, fp.risk_level, gn.district_name, gn.latitude, gn.longitude
      ORDER BY fp.flood_depth_cm DESC
      LIMIT 10
    `);
    console.log(`  ✓ Worst areas: ${worstResult.rows.length} nodes`);

    // 2) Current status (latest per node in last 24h)
    const statusResult = await client.query(`
      SELECT DISTINCT ON (fp.node_id)
        fp.node_id,
        fp.flood_depth_cm,
        fp.risk_level,
        fp.time,
        gn.district_name,
        gn.latitude,
        gn.longitude
      FROM flood_predictions fp
      LEFT JOIN grid_nodes gn ON gn.node_id = fp.node_id
      WHERE fp.time >= NOW() - INTERVAL '24 hours'
      ORDER BY fp.node_id, fp.time DESC
      LIMIT 10
    `);
    console.log(`  ✓ Current status: ${statusResult.rows.length} nodes`);

    // 3) Forecast summary (96h ahead)
    const forecastResult = await client.query(`
      SELECT 
        CASE 
          WHEN flood_depth_cm <= 10 THEN 'safe'
          WHEN flood_depth_cm <= 20 THEN 'medium'
          WHEN flood_depth_cm <= 40 THEN 'high'
          ELSE 'severe'
        END as risk_level,
        COUNT(*)::int as count
      FROM flood_predictions
      WHERE time >= NOW() AND time <= NOW() + INTERVAL '96 hours'
      GROUP BY risk_level
    `);
    console.log(`  ✓ Forecast summary: ${forecastResult.rows.length} risk levels`);

    console.log(`  ✅ Flood cache populated successfully`);
    return {
      worstAreas: worstResult.rows,
      currentStatus: statusResult.rows,
      forecastSummary: forecastResult.rows,
      lastUpdated: new Date(),
    };
  } catch (error) {
    console.error(`  ✗ Lỗi populate flood cache:`, error.message);
    return null;
  }
}

async function populateWeatherCache(client) {
  console.log('\n🌡️  Populate Weather Cache...');
  
  try {
    // Lấy thời tiết hiện tại từ các trạm
    const result = await client.query(`
      SELECT DISTINCT ON (wm.node_id)
        wm.node_id,
        wm.temp,
        wm.humidity,
        wm.prcp,
        wm.clouds,
        wm.windSpeed,
        wm.pressure,
        wm.time,
        ws.station_name
      FROM weather_measurements wm
      LEFT JOIN weather_stations ws ON ws.station_id = wm.station_id
      WHERE wm.time >= NOW() - INTERVAL '1 hour'
      ORDER BY wm.node_id, wm.time DESC
    `);
    console.log(`  ✓ Current weather data: ${result.rows.length} stations`);
    console.log(`  ✅ Weather cache populated successfully`);
    return result.rows;
  } catch (error) {
    console.error(`  ✗ Lỗi populate weather cache:`, error.message);
    return null;
  }
}

async function populateDashboardCache(client) {
  console.log('\n📈 Populate Dashboard Cache...');
  
  try {
    // Global risk summary
    const globalRisk = await client.query(`
      SELECT 
        CASE 
          WHEN flood_depth_cm <= 10 THEN 'safe'
          WHEN flood_depth_cm <= 20 THEN 'medium'
          WHEN flood_depth_cm <= 40 THEN 'high'
          ELSE 'severe'
        END as risk_level,
        COUNT(*)::int as count
      FROM (
        SELECT DISTINCT ON (node_id) flood_depth_cm
        FROM flood_predictions
        WHERE time >= NOW() - INTERVAL '24 hours'
        ORDER BY node_id, time DESC
      ) latest
      GROUP BY risk_level
    `);
    console.log(`  ✓ Global risk counts: ${globalRisk.rows.length} categories`);

    // Risk trend (7 days)
    const trend = await client.query(`
      SELECT 
        date_trunc('day', time) as day,
        CASE 
          WHEN flood_depth_cm <= 10 THEN 'safe'
          WHEN flood_depth_cm <= 20 THEN 'medium'
          WHEN flood_depth_cm <= 40 THEN 'high'
          ELSE 'severe'
        END as risk_level,
        COUNT(*)::int as count
      FROM flood_predictions
      WHERE time >= NOW() - INTERVAL '7 days'
      GROUP BY 1, 2
      ORDER BY 1 DESC, 2
    `);
    console.log(`  ✓ Risk trend (7 days): ${trend.rows.length} data points`);
    console.log(`  ✅ Dashboard cache populated successfully`);
    return {
      globalRisk: globalRisk.rows,
      trend: trend.rows,
    };
  } catch (error) {
    console.error(`  ✗ Lỗi populate dashboard cache:`, error.message);
    return null;
  }
}

async function main() {
  try {
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║   📦 POPULATE APPLICATION CACHE                       ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    const client = await connectToDb();

    // Populate tất cả cache
    const floodCache = await populateFloodCache(client);
    const weatherCache = await populateWeatherCache(client);
    const dashboardCache = await populateDashboardCache(client);

    await client.end();

    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║   ✅ CACHE POPULATED SUCCESSFULLY!                    ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    console.log('📋 Cache Stats:');
    if (floodCache) {
      console.log(`  • Flood predictions: ${floodCache.worstAreas.length} worst areas`);
    }
    if (weatherCache) {
      console.log(`  • Weather data: ${weatherCache.length} stations`);
    }
    if (dashboardCache) {
      console.log(`  • Dashboard: ${dashboardCache.globalRisk.length} risk categories`);
    }
    
    console.log('\n🚀 Sẵn sàng khởi động backend!');
    console.log('   npm start');

  } catch (error) {
    console.error('\n✗ LỖI POPULATE CACHE:', error);
    process.exit(1);
  }
}

main();
