'use strict'

/**
 * redisClient.js
 *
 * Khởi tạo Redis client dùng chung cho toàn backend.
 * Dùng ioredis (hoặc redis v4 tuỳ cài đặt).
 * Biến môi trường: REDIS_URL (mặc định redis://127.0.0.1:6379)
 */

const { createClient } = require('redis')

const client = createClient({
  url: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
})

client.on('error', (err) => {
  // Chỉ log các lỗi không phải ECONNREFUSED để tránh rác terminal khi test ở Local không có Redis
  if (err.code !== 'ECONNREFUSED') {
    console.error('[Redis] Lỗi kết nối:', err.message)
  }
})

client.on('connect', () => {
  console.log('[Redis] Kết nối thành công.')
})

  // Kết nối ngay khi module được nạp
  ; (async () => {
    try {
      await client.connect()
    } catch (err) {
      console.error('[Redis] Không thể kết nối, cache sẽ bị bỏ qua:', err.message)
    }
  })()

module.exports = client
