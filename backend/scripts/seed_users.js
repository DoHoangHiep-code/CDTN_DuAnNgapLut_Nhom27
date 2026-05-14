'use strict'

/**
 * scripts/seed_users.js – Tạo 1 Admin + 3 Analyst mẫu
 * Mật khẩu hash bằng bcrypt (salt rounds = 12)
 */

require('dotenv').config()

const bcrypt  = require('bcrypt')
const { sequelize } = require('../src/db/sequelize')
const { QueryTypes } = require('sequelize')

const SALT_ROUNDS = 12

const USERS = [
  {
    username:  'admin',
    email:     'admin@aquaalert.vn',
    full_name: 'Quản trị viên AQUAALERT',
    password:  'Admin@2026!',
    role:      'admin',
  },
  {
    username:  'analyst1',
    email:     'analyst1@aquaalert.vn',
    full_name: 'Nguyễn Văn An – Phân tích viên',
    password:  'Analyst@2026!',
    role:      'expert',
  },
  {
    username:  'analyst2',
    email:     'analyst2@aquaalert.vn',
    full_name: 'Trần Thị Bình – Phân tích viên',
    password:  'Analyst@2026!',
    role:      'expert',
  },
  {
    username:  'analyst3',
    email:     'analyst3@aquaalert.vn',
    full_name: 'Lê Minh Cường – Phân tích viên',
    password:  'Analyst@2026!',
    role:      'expert',
  },
]

async function main() {
  console.log('\n[SeedUsers] Bắt đầu tạo tài khoản mẫu...')
  await sequelize.authenticate()

  for (const u of USERS) {
    const hash = await bcrypt.hash(u.password, SALT_ROUNDS)
    try {
      await sequelize.query(`
        INSERT INTO users (username, email, full_name, password_hash, role, created_at)
        VALUES (:username, :email, :full_name, :hash, :role, NOW())
        ON CONFLICT (username) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            email         = EXCLUDED.email,
            full_name     = EXCLUDED.full_name,
            role          = EXCLUDED.role;
      `, {
        replacements: { username: u.username, email: u.email, full_name: u.full_name, hash, role: u.role },
        type: QueryTypes.INSERT,
      })
      console.log(`  ✅ [${u.role.padEnd(6)}] ${u.username} — ${u.email}`)
    } catch (e) {
      console.error(`  ❌ ${u.username}: ${e.message}`)
    }
  }

  const rows = await sequelize.query('SELECT username, role, email FROM users ORDER BY role;', { type: QueryTypes.SELECT })
  console.log('\n📋 Tài khoản trong DB:')
  rows.forEach(r => console.log(`   [${r.role}] ${r.username} – ${r.email}`))
  console.log('\n[SeedUsers] ✅ Hoàn tất!\n')
}

main()
  .catch(e => { console.error('❌', e.message); process.exit(1) })
  .finally(() => sequelize.close())
