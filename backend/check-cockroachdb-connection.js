/**
 * Script kiểm tra kết nối CockroachDB trước migration
 * 
 * Cách sử dụng:
 *   node check-cockroachdb-connection.js
 */

require('dotenv').config();
const { Client } = require('pg');

const OLD_DB_URL = 'postgresql://h1234561:W9gqW225ZIMsX6Cdin-g1w@cosmic-kite-15897.jxf.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full';
const NEW_DB_URL = process.env.DATABASE_URL || 'postgresql://s_:_rIigkJpJxIP9RJUS4OkTw@ninja-hacker-15200.jxf.gcp-asia-southeast1.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full';

const sslConfig = {
  rejectUnauthorized: false,
};

async function testConnection(url, label) {
  try {
    const client = new Client({
      connectionString: url,
      ssl: sslConfig,
    });

    const start = Date.now();
    await client.connect();
    const duration = Date.now() - start;

    // Lấy thông tin server
    const versionResult = await client.query('SELECT version()');
    const version = versionResult.rows[0].version;

    // Lấy danh sách bảng
    const tablesResult = await client.query(`
      SELECT COUNT(*) as table_count 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
    `);
    const tableCount = tablesResult.rows[0].table_count;

    // Lấy tổng rows
    const rowsResult = await client.query(`
      SELECT SUM(n_tup_ins - n_tup_del) as total_rows
      FROM pg_stat_user_tables
    `);
    const totalRows = rowsResult.rows[0].total_rows || 0;

    await client.end();

    return {
      success: true,
      duration,
      version: version.substring(0, 80),
      tableCount,
      totalRows,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║   🔍 KIỂM TRA KẾT NỐI COCKROACHDB                    ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  console.log('Đang kiểm tra...\n');

  // Test DB cũ
  console.log('📊 Server CŨ (cosmic-kite):');
  const oldResult = await testConnection(OLD_DB_URL, 'DB CŨ');

  if (oldResult.success) {
    console.log(`  ✓ Kết nối thành công (${oldResult.duration}ms)`);
    console.log(`  ├─ Version: ${oldResult.version}`);
    console.log(`  ├─ Bảng: ${oldResult.tableCount}`);
    console.log(`  └─ Tổng rows: ${oldResult.totalRows}`);
  } else {
    console.log(`  ✗ Lỗi: ${oldResult.error}`);
  }

  console.log('\n📊 Server MỚI (ninja-hacker):');
  const newResult = await testConnection(NEW_DB_URL, 'DB MỚI');

  if (newResult.success) {
    console.log(`  ✓ Kết nối thành công (${newResult.duration}ms)`);
    console.log(`  ├─ Version: ${newResult.version}`);
    console.log(`  ├─ Bảng: ${newResult.tableCount}`);
    console.log(`  └─ Tổng rows: ${newResult.totalRows}`);
  } else {
    console.log(`  ✗ Lỗi: ${newResult.error}`);
  }

  console.log('\n════════════════════════════════════════════════════════');
  console.log('📋 KẾT LUẬN:');

  if (oldResult.success && newResult.success) {
    console.log('✓ Cả 2 server đều sẵn sàng cho migration');
    console.log('\n🚀 Sẵn sàng chạy: node migrate-cockroachdb.js');
  } else if (oldResult.success) {
    console.log('⚠ Server cũ OK, nhưng server mới có vấn đề');
    console.log('   Kiểm tra credentials hoặc kết nối mạng');
  } else if (newResult.success) {
    console.log('⚠ Server mới OK, nhưng server cũ có vấn đề');
    console.log('   Kiểm tra credentials hoặc kết nối mạng');
  } else {
    console.log('✗ Cả 2 server đều có vấn đề');
    console.log('   Kiểm tra:.env file và kết nối mạng');
  }
  console.log('════════════════════════════════════════════════════════\n');
}

main();
