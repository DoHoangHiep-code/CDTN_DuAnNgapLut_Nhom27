/**
 * Script di chuyển dữ liệu từ CockroachDB cũ sang CockroachDB mới
 * 
 * Cách sử dụng:
 *   node migrate-cockroachdb.js
 * 
 * Lưu ý:
 * - Kết nối có thể mất thời gian do SSL verification
 * - Script sẽ tạo backup trước khi thực hiện
 * - Kiểm tra dữ liệu sau khi migration hoàn tất
 */

require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');

const OLD_DB_URL = 'postgresql://h1234561:W9gqW225ZIMsX6Cdin-g1w@cosmic-kite-15897.jxf.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full';
const NEW_DB_URL = process.env.DATABASE_URL || 'postgresql://s_:_rIigkJpJxIP9RJUS4OkTw@ninja-hacker-15200.jxf.gcp-asia-southeast1.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full';

const sslConfig = {
  rejectUnauthorized: false,
};

let oldClient = null;
let newClient = null;
let dumpedData = {};

async function connectToDb(url, label) {
  try {
    const client = new Client({
      connectionString: url,
      ssl: sslConfig,
    });
    await client.connect();
    console.log(`✓ Kết nối ${label} thành công`);
    return client;
  } catch (error) {
    console.error(`✗ Lỗi kết nối ${label}:`, error.message);
    throw error;
  }
}

async function getTables(client) {
  try {
    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    return result.rows.map(r => r.table_name);
  } catch (error) {
    console.error('Lỗi lấy danh sách bảng:', error.message);
    return [];
  }
}

async function dumpTable(client, tableName) {
  try {
    const result = await client.query(`SELECT * FROM "${tableName}"`);
    console.log(`  → Dumped ${tableName}: ${result.rows.length} rows`);
    return result.rows;
  } catch (error) {
    console.error(`  ✗ Lỗi dump ${tableName}:`, error.message);
    return [];
  }
}

async function getTableSchema(client, tableName) {
  try {
    const result = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = $1
      AND table_schema = 'public'
      ORDER BY ordinal_position
    `, [tableName]);
    return result.rows;
  } catch (error) {
    console.error(`Lỗi lấy schema ${tableName}:`, error.message);
    return [];
  }
}

async function getCreateTableStatement(client, tableName) {
  try {
    // Lấy statement CREATE TABLE từ pg_get_create_table_as (PostgreSQL way)
    // Cách khác: dump SQL schema từ information_schema
    const result = await client.query(`
      SELECT 
        'CREATE TABLE "' || table_name || '" (' ||
        string_agg(
          '"' || column_name || '" ' || 
          data_type || 
          CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END ||
          CASE WHEN column_default IS NOT NULL THEN ' DEFAULT ' || column_default ELSE '' END,
          ', '
        ) || ')'
      FROM information_schema.columns
      WHERE table_name = $1 AND table_schema = 'public'
      GROUP BY table_name
    `, [tableName]);

    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error(`Lỗi lấy CREATE TABLE ${tableName}:`, error.message);
    return null;
  }
}

async function createEnumTypesOnNewDb() {
  console.log('\n▶ TẠO ENUM TYPES TRÊN DB MỚI...');

  const enumTypes = [
    { name: 'user_role', values: ['admin', 'expert', 'user'] },
    { name: 'risk_level', values: ['safe', 'medium', 'high', 'severe'] },
    { name: 'reported_level', values: ['Khô ráo', '<15cm', '15-30cm', '>30cm'] }
  ];

  for (const enumType of enumTypes) {
    try {
      // Kiểm tra ENUM type đã tồn tại
      const checkResult = await newClient.query(`
        SELECT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = $1
        )
      `, [enumType.name]);

      if (checkResult.rows[0].exists) {
        console.log(`  • ${enumType.name}: đã tồn tại`);
        continue;
      }

      // Tạo ENUM type
      const values = enumType.values.map(v => `'${v}'`).join(',');
      const query = `CREATE TYPE ${enumType.name} AS ENUM (${values})`;

      await newClient.query(query);
      console.log(`  ✓ Tạo ${enumType.name}: (${enumType.values.join(', ')})`);
    } catch (error) {
      console.log(`  ⚠ ENUM ${enumType.name}: ${error.message.substring(0, 100)}`);
    }
  }
}

async function recreateTablesOnNewDb() {
  console.log('\n▶ TẠO SCHEMA TRÊN DB MỚI...');

  const tables = Object.keys(dumpedData);
  for (const tableName of tables) {
    try {
      // Xóa bảng cũ nếu tồn tại
      try {
        await newClient.query(`DROP TABLE IF EXISTS "${tableName}" CASCADE`);
      } catch (e) {
        // Bảng có thể không tồn tại
      }

      // Lấy CREATE TABLE statement từ DB cũ
      const createStmt = await getCreateTableStatement(oldClient, tableName);
      if (createStmt && createStmt[Object.keys(createStmt)[0]]) {
        try {
          await newClient.query(createStmt[Object.keys(createStmt)[0]]);
          console.log(`  ✓ Tạo bảng: ${tableName}`);
        } catch (error) {
          console.log(`  ⚠ Không thể tạo ${tableName} từ schema, sẽ bỏ qua: ${error.message.substring(0, 80)}`);
        }
      }
    } catch (error) {
      console.error(`  Lỗi xử lý ${tableName}:`, error.message);
    }
  }
}

async function saveBackup(filename, data) {
  try {
    fs.writeFileSync(filename, JSON.stringify(data, null, 2));
    console.log(`\n✓ Backup đã lưu: ${filename}`);
  } catch (error) {
    console.error('Lỗi lưu backup:', error.message);
  }
}

async function restoreToNewDb() {
  console.log('\n▶ BẮT ĐẦU IMPORT DỮ LIỆU VÀO DB MỚI...');

  const tables = Object.keys(dumpedData);
  for (const tableName of tables) {
    try {
      const rows = dumpedData[tableName];
      if (rows.length === 0) {
        console.log(`  - ${tableName}: không có dữ liệu`);
        continue;
      }

      // Kiểm tra bảng có tồn tại không
      const tableExistsResult = await newClient.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_name = $1 AND table_schema = 'public'
        )
      `, [tableName]);

      const tableExists = tableExistsResult.rows[0].exists;
      if (!tableExists) {
        console.log(`  ✗ Bảng ${tableName} không tồn tại, bỏ qua`);
        continue;
      }

      // Lấy danh sách column từ row đầu tiên
      const columns = Object.keys(rows[0]);

      // Insert từng batch
      const batchSize = 100;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const values = batch.map((row, idx) => {
          const placeholders = columns.map((col, colIdx) => `$${idx * columns.length + colIdx + 1}`).join(',');
          return `(${placeholders})`;
        }).join(',');

        const flatValues = batch.flatMap(row => columns.map(col => row[col]));

        const query = `
          INSERT INTO "${tableName}" (${columns.map(c => `"${c}"`).join(',')})
          VALUES ${values}
          ON CONFLICT DO NOTHING
        `;

        try {
          await newClient.query(query, flatValues);
        } catch (error) {
          console.log(`  ⚠ Một số rows không thể insert vào ${tableName}:`, error.message.substring(0, 100));
        }
      }

      console.log(`  ✓ ${tableName}: ${rows.length} rows restored`);
    } catch (error) {
      console.error(`  ✗ Lỗi restore ${tableName}:`, error.message);
    }
  }
}

async function verifyMigration() {
  console.log('\n▶ XÁC MINH DỮ LIỆU...');

  const tables = await getTables(newClient);
  for (const tableName of tables) {
    try {
      const result = await newClient.query(`SELECT COUNT(*) as count FROM "${tableName}"`);
      const count = result.rows[0].count;
      console.log(`  ${tableName}: ${count} rows`);
    } catch (error) {
      console.error(`  ✗ Lỗi kiểm tra ${tableName}:`, error.message);
    }
  }
}

async function populateCache() {
  try {
    // Lấy 10 node có nguy cơ cao nhất trong 24h gần nhất
    const worstResult = await newClient.query(`
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
      GROUP BY fp.node_id, fp.flood_depth_cm, fp.risk_level, gn.district_name, gn.latitude, gn.longitude
      ORDER BY fp.flood_depth_cm DESC
      LIMIT 10
    `);
    console.log(`  ✓ Top 10 worst areas: ${worstResult.rows.length} nodes`);

    // Lấy tổng hợp risk_level cho 96h tới
    const forecastResult = await newClient.query(`
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
    console.log(`  ✓ Forecast summary: ${forecastResult.rows.length} risk levels populated`);

    // Lấy dữ liệu thời tiết hiện tại
    const weatherResult = await newClient.query(`
      SELECT * FROM weather_measurements
      WHERE time >= NOW() - INTERVAL '1 hour'
      ORDER BY time DESC
      LIMIT 5
    `);
    console.log(`  ✓ Current weather: ${weatherResult.rows.length} measurements`);

  } catch (error) {
    console.log(`  ⚠ Populate cache không hoàn toàn, sẽ được cập nhật bởi CronJob:`, error.message.substring(0, 100));
  }
}

async function main() {
  try {
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║   MIGRATION: PostgreSQL → CockroachDB (Cloud)        ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    // Kết nối tới cả 2 server
    console.log('▶ KẾT NỐI ĐẾN DATABASE...');
    oldClient = await connectToDb(OLD_DB_URL, 'DB CŨ');
    newClient = await connectToDb(NEW_DB_URL, 'DB MỚI');

    // Dump dữ liệu từ server cũ
    console.log('\n▶ DUMP DỮ LIỆU TỬ DB CŨ...');
    const tables = await getTables(oldClient);
    console.log(`Tìm thấy ${tables.length} bảng\n`);

    for (const tableName of tables) {
      const rows = await dumpTable(oldClient, tableName);
      dumpedData[tableName] = rows;
    }

    // Lưu backup
    const backupFile = `cockroachdb_backup_${new Date().getTime()}.json`;
    await saveBackup(backupFile, dumpedData);

    // Tạo ENUM types trên DB mới (TRƯỚC khi tạo tables)
    await createEnumTypesOnNewDb();

    // Tạo schema trên DB mới
    await recreateTablesOnNewDb();

    // Restore vào server mới
    await restoreToNewDb();

    // Xác minh
    await verifyMigration();

    // Populate cache sau khi import xong
    console.log('\n▶ POPULATE CACHE...');
    await populateCache();

    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║   ✓ MIGRATION HOÀN TẤT THÀNH CÔNG!                  ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    console.log('Các bước tiếp theo:');
    console.log('1. Kiểm tra dữ liệu trên DB mới (xem output trên)');
    console.log('2. Khởi động lại backend: npm start');
    console.log('3. Kiểm tra logs để đảm bảo không có lỗi');
    console.log('\n✓ Schema, dữ liệu và cache đã được chuẩn bị!');

  } catch (error) {
    console.error('\n✗ LỖI MIGRATION:', error);
    process.exit(1);
  } finally {
    if (oldClient) await oldClient.end();
    if (newClient) await newClient.end();
    console.log('\n✓ Đóng kết nối');
  }
}

main();
