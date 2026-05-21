'use strict'
/**
 * export_old_db.js – Export dữ liệu cần thiết từ OLD DB
 * Xuất ra: landslide_grid_nodes (425K rows), users (kiểm tra)
 */
const { Client } = require('pg')
const fs = require('fs')
const path = require('path')

const OLD_URL = 'postgresql://h1234561:RxHwLkmC_voC-x7ZLODUbA@cosmic-kite-15897.jxf.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full'

async function main() {
  const client = new Client({ connectionString: OLD_URL })
  await client.connect()
  console.log('✅ Kết nối OLD DB thành công.')

  // 1. Kiểm tra users trong OLD DB
  console.log('\n--- USERS (OLD) ---')
  const users = await client.query('SELECT user_id, username, email, role FROM users ORDER BY user_id')
  for (const u of users.rows) console.log(`  [${u.role}] ${u.username} – ${u.email}`)

  // 2. Kiểm tra cấu trúc landslide_grid_nodes
  console.log('\n--- LANDSLIDE_GRID_NODES columns ---')
  const cols = await client.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'landslide_grid_nodes' 
    ORDER BY ordinal_position
  `)
  for (const c of cols.rows) console.log(`  ${c.column_name}: ${c.data_type}`)

  // 4. Kiểm tra actual_flood_reports
  console.log('\n--- ACTUAL_FLOOD_REPORTS (OLD, sample) ---')
  const afr = await client.query('SELECT * FROM actual_flood_reports LIMIT 5')
  for (const r of afr.rows) console.log(' ', JSON.stringify(r))

  await client.end()
  console.log('\nDone.')
}

main().catch(e => { console.error('❌', e.message); process.exit(1) })
