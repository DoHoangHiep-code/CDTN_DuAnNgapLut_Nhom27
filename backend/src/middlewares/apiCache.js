'use strict'

const NodeCache = require('node-cache')

// Tạo 1 instance chung, lưu giữ liệu trong RAM. Cấu hình kiểm tra quá hạn mỗi phút.
const globalCache = new NodeCache({ stdTTL: 0, checkperiod: 60 })

/**
 * Middleware cache API responses
 * @param {number} ttlSeconds - Thời gian sống của cache tính bằng giây
 * @param {string} namespace - Namespace để dễ dàng invalidate theo nhóm (vd: 'landslide_api', 'flood_api')
 */
function cacheResponse(ttlSeconds, namespace = 'global') {
  return (req, res, next) => {
    // Chỉ cache GET requests
    if (req.method !== 'GET') {
      return next()
    }

    // Tạo key dựa trên namespace và chuỗi originalUrl (bao gồm cả query params)
    const key = `${namespace}_${req.originalUrl}`
    const cachedResponse = globalCache.get(key)

    if (cachedResponse) {
      console.log(`[Cache Hit] Trả về từ RAM (node-cache): ${key}`)
      return res.status(200).json(cachedResponse)
    }

    // Gắn hook vào res.json để tự động lưu cache trước khi response
    const originalJson = res.json.bind(res)
    res.json = (body) => {
      // Chỉ cache khi request thành công
      if (res.statusCode >= 200 && res.statusCode < 300 && body && body.success !== false) {
        // Gắn thêm flag _cached_source để client nhận diện nếu cần
        const bodyToCache = { ...body, _cached_source: 'node-cache', _cached_at: new Date().toISOString() }
        globalCache.set(key, bodyToCache, ttlSeconds)
        console.log(`[Cache Miss] Đã ghi vào RAM (node-cache): ${key} (TTL: ${ttlSeconds}s)`)
      }
      return originalJson(body)
    }

    next()
  }
}

/**
 * Xóa tất cả các cache key thuộc về một namespace cụ thể
 * @param {string} namespace - Namespace cần xóa
 */
function invalidateCacheNamespace(namespace) {
  const keys = globalCache.keys()
  const keysToDelete = keys.filter(k => k.startsWith(`${namespace}_`))
  
  if (keysToDelete.length > 0) {
    globalCache.del(keysToDelete)
    console.log(`[Cache Invalidate] 🧹 Đã dọn dẹp ${keysToDelete.length} keys của namespace '${namespace}'`)
  } else {
    console.log(`[Cache Invalidate] Namespace '${namespace}' đang trống, không cần xóa.`)
  }
}

module.exports = {
  cacheResponse,
  invalidateCacheNamespace,
  globalCache // Export nếu cần theo dõi stats
}
