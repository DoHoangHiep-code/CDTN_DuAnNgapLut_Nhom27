/**
 * Script fix ENUM types trên CockroachDB
 * Chạy này nếu gặp lỗi "type does not exist"
 * 
 * Cách sử dụng:
 *   node fix-enum-types.js
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

async function createEnumTypes(client) {
  console.log('\n📋 TẠO ENUM TYPES...');
  
  const enumTypes = [
    { name: 'user_role', values: ['admin', 'expert', 'user'] },
    { name: 'risk_level', values: ['safe', 'medium', 'high', 'severe'] },
    { name: 'reported_level', values: ['Khô ráo', '<15cm', '15-30cm', '>30cm'] }
  ];

  for (const enumType of enumTypes) {
    try {
      // Kiểm tra ENUM type đã tồn tại
      const checkResult = await client.query(`
        SELECT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = $1 AND typtype = 'e'
        )
      `, [enumType.name]);

      if (checkResult.rows[0].exists) {
        console.log(`  ✓ ${enumType.name}: đã tồn tại`);
        continue;
      }

      // Tạo ENUM type
      const values = enumType.values.map(v => `'${v}'`).join(',');
      const query = `CREATE TYPE ${enumType.name} AS ENUM (${values})`;
      
      await client.query(query);
      console.log(`  ✓ Tạo mới ${enumType.name}: (${enumType.values.join(', ')})`);
    } catch (error) {
      console.error(`  ✗ ${enumType.name}: ${error.message.substring(0, 120)}`);
    }
  }
}

async function main() {
  try {
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║   🔧 FIX ENUM TYPES ON COCKROACHDB                   ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    const client = await connectToDb();

    // Tạo ENUM types
    await createEnumTypes(client);

    await client.end();

    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║   ✅ ENUM TYPES CREATED SUCCESSFULLY!                 ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    console.log('🚀 Bây giờ bạn có thể chạy lại cron job:');
    console.log('   npm start');

  } catch (error) {
    console.error('\n✗ LỖI FIX ENUM TYPES:', error);
    process.exit(1);
  }
}

main();
