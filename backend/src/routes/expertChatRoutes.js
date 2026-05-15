// 'use strict'

// /**
//  * expertChatRoutes.js
//  *
//  * POST /api/v1/chat/expert
//  * Body: { question: string, grid_id?: string, lat?: number, lng?: number }
//  *
//  * Luồng:
//  *  1. Lấy flood features từ Redis / CockroachDB
//  *  2. Gọi Python AI service (port 8000) lấy xác suất CatBoost
//  *  3. buildExpertAnswer() kết hợp AI + Rule-based → câu trả lời tiếng Việt
//  *
//  * PERF FIX (2026-05-08):
//  *  - Thêm Promise.race timeout 8s quanh DB lookup
//  *    → trả 503 ngay thay vì treo 60s khi pool exhausted
//  *  - Thêm extractAreaFromQuestion() để tự detect tên địa danh trong câu hỏi
//  */

// const express = require('express')
// const axios = require('axios')
// const { getFeatureByGridId, getFeatureByLatLng } = require('../services/floodFeature.service')

// const router = express.Router()

// const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000'
// const DB_LOOKUP_TIMEOUT_MS = 8000

// // Danh sách địa danh – dùng để trích xuất từ câu hỏi khi không có grid_id/lat
// const AREA_KEYWORDS = [
//   'triều khúc', 'cầu giấy', 'hoàn kiếm', 'đống đa', 'hà đông', 'thanh xuân',
//   'bắc từ liêm', 'nam từ liêm', 'tây hồ', 'long biên', 'hoàng mai', 'hai bà trưng',
//   'ba đình', 'gia lâm', 'sóc sơn', 'đông anh', 'mê linh', 'thường tín',
//   'phú xuyên', 'ứng hòa', 'mỹ đức', 'thanh oai', 'chương mỹ', 'quốc oai',
//   'thạch thất', 'phúc thọ', 'dan phượng', 'hoài đức',
// ]

// /**
//  * Bao một Promise với timeout, ném lỗi có code 'LOOKUP_TIMEOUT' nếu quá giờ.
//  */
// function withDbTimeout(promise) {
//   let timer
//   const tp = new Promise((_, reject) => {
//     timer = setTimeout(() => {
//       const err = new Error(`DB lookup timed out after ${DB_LOOKUP_TIMEOUT_MS}ms`)
//       err.code = 'LOOKUP_TIMEOUT'
//       reject(err)
//     }, DB_LOOKUP_TIMEOUT_MS)
//   })
//   return Promise.race([promise, tp]).finally(() => clearTimeout(timer))
// }

// /**
//  * Trích xuất tên địa danh từ câu hỏi (nếu có)
//  * @param {string} question
//  * @returns {string|null}
//  */
// function extractAreaFromQuestion(question) {
//   const m = question.toLowerCase()
//   return AREA_KEYWORDS.find(kw => m.includes(kw)) ?? null
// }

// // ── Helpers ───────────────────────────────────────────────────────────────────

// const RISK_LABEL = {
//   safe: 'An toàn 🟢',
//   medium: 'Nguy cơ thấp 🟡',
//   high: 'Nguy cơ cao 🟠',
//   severe: 'Nguy hiểm nghiêm trọng 🔴',
// }

// function riskVN(level) {
//   return RISK_LABEL[level] ?? level ?? 'Không xác định'
// }

// /**
//  * Chuẩn hóa features từ DB row → payload cho AI service
//  */
// function buildAIPayload(f) {
//   const now = new Date()
//   const hour = Number(f.hour ?? now.getHours())
//   const month = Number(f.month ?? now.getMonth() + 1)
//   const startOfYear = new Date(now.getFullYear(), 0, 0)
//   const dayofyear = Math.floor((now - startOfYear) / 86400000)
//   const dayofweek = now.getDay()

//   return {
//     prcp: Number(f.prcp ?? 0),
//     prcp_3h: Number(f.prcp_3h ?? 0),
//     prcp_6h: Number(f.prcp_6h ?? 0),
//     prcp_12h: Number(f.prcp_12h ?? 0),
//     prcp_24h: Number(f.prcp_24h ?? 0),
//     temp: Number(f.temp ?? 28),
//     rhum: Number(f.rhum ?? 70),
//     wspd: Number(f.wspd ?? 0),
//     pres: Number(f.pres ?? 1010),
//     pressure_change_24h: Number(f.pressure_change_24h ?? 0),
//     max_prcp_3h: Number(f.max_prcp_3h ?? 0),
//     max_prcp_6h: Number(f.max_prcp_6h ?? 0),
//     max_prcp_12h: Number(f.max_prcp_12h ?? 0),
//     elevation: Number(f.elevation ?? 5),
//     slope: Number(f.slope ?? 1),
//     impervious_ratio: Number(f.impervious_ratio ?? 0.5),
//     dist_to_drain_km: Number(f.dist_to_drain_km ?? 0.5),
//     dist_to_river_km: Number(f.dist_to_river_km ?? 1),
//     dist_to_pump_km: Number(f.dist_to_pump_km ?? 1),
//     dist_to_main_road_km: Number(f.dist_to_main_road_km ?? 0.3),
//     dist_to_park_km: Number(f.dist_to_park_km ?? 0.5),
//     hour,
//     dayofweek,
//     month,
//     dayofyear,
//     hour_sin: Math.sin((2 * Math.PI * hour) / 24),
//     hour_cos: Math.cos((2 * Math.PI * hour) / 24),
//     month_sin: Math.sin((2 * Math.PI * month) / 12),
//     month_cos: Math.cos((2 * Math.PI * month) / 12),
//     rainy_season_flag: f.rainy_season_flag === true || f.rainy_season_flag === 1 ? 1 : 0,
//   }
// }

// /**
//  * Gọi Python AI service để lấy flood_depth_cm và risk_level.
//  *
//  * @returns {{ data: object, timedOut: boolean } | null}
//  *   - data.timedOut = true  → AI quá tải, caller dùng fallback rule-based
//  *   - null                  → lỗi mạng/kết nối, caller dùng fallback rule-based
//  */
// async function callAIService(features) {
//   try {
//     const res = await axios.post(`${AI_SERVICE_URL}/api/predict`, features, {
//       timeout: 8000, // 8 giây – đủ cho model warm sau khi có warm-up
//     })
//     return { data: res.data, timedOut: false } // { flood_depth_cm, risk_level }
//   } catch (err) {
//     // Phân biệt timeout vs lỗi mạng khác – để caller hiển thị thông báo phù hợp
//     if (err.code === 'ECONNABORTED' || err.message?.toLowerCase().includes('timeout')) {
//       console.warn('[ExpertChat] AI service TIMEOUT (>8s) – fallback rule-based.')
//       return { data: null, timedOut: true }
//     }
//     console.warn('[ExpertChat] AI service không phản hồi:', err.message)
//     return null
//   }
// }

// /**
//  * Phân tích rule-based từ features → danh sách lý do ngập
//  */
// function buildRuleReasons(f) {
//   const reasons = []

//   if (f.prcp_24h >= 120) reasons.push(`Mưa tích lũy 24h đạt **${f.prcp_24h} mm** — hệ thống thoát nước dễ quá tải.`)
//   if (f.prcp_6h >= 80) reasons.push(`Mưa 6 giờ đạt **${f.prcp_6h} mm** — nước tích tụ nhanh trên bề mặt.`)
//   if (f.prcp_3h >= 50) reasons.push(`Cường độ mưa 3h đạt **${f.prcp_3h} mm** — mưa ngắn hạn cực lớn.`)
//   if (f.max_prcp_3h >= 30) reasons.push(`Cường độ cực đại 3h: **${f.max_prcp_3h} mm** — đỉnh mưa vượt ngưỡng.`)
//   if (f.elevation <= 5) reasons.push(`Cao độ địa hình thấp (**${f.elevation} m**) — nước từ nơi cao chảy về.`)
//   if (f.slope <= 1) reasons.push(`Độ dốc nhỏ (**${f.slope}**) — nước thoát chậm, lưu lại mặt đường.`)
//   if (f.impervious_ratio >= 0.7) reasons.push(`Bê tông hóa cao (**${f.impervious_ratio}**) — nước không thấm, tạo dòng mặt lớn.`)
//   if (f.dist_to_drain_km <= 0.4) reasons.push(`Gần hệ thống thoát nước (**${f.dist_to_drain_km} km**) — có thể là điểm nghẽn.`)
//   if (f.dist_to_river_km <= 1) reasons.push(`Gần sông/kênh (**${f.dist_to_river_km} km**) — ảnh hưởng mực nước sông khi mưa lớn.`)
//   if (f.rainy_season_flag === 1) reasons.push('Đang trong **mùa mưa** — xác suất xuất hiện mưa lớn cao hơn.')

//   return reasons
// }

// /**
//  * Sinh câu trả lời chuyên sâu tiếng Việt kết hợp AI + rule-based
//  * @param {string}  question   - Câu hỏi gốc của người dùng
//  * @param {object}  features   - Feature vector (buildAIPayload output)
//  * @param {object}  dbRow      - Dòng dữ liệu gốc từ DB
//  * @param {object|null} aiResult - Kết quả từ AI service { flood_depth_cm, risk_level }
//  */
// function buildExpertAnswer(question, features, dbRow, aiResult) {
//   const locationName = dbRow?.location_name || dbRow?.grid_id || `Node ${dbRow?.node_id}`

//   const riskLevel = aiResult?.risk_level ?? dbRow?.risk_level ?? 'unknown'
//   const depthCm = aiResult?.flood_depth_cm ?? Number(dbRow?.flood_depth_cm ?? 0)

//   const reasons = buildRuleReasons(features)

//   let answer = ''

//   // ── Tiêu đề ──────────────────────────────────────────────────────────────────
//   answer += `## 🌊 Phân tích chuyên gia – ${locationName}\n\n`

//   // ── Tóm tắt ──────────────────────────────────────────────────────────────────
//   answer += `**Mức rủi ro ngập:** ${riskVN(riskLevel)}\n`
//   answer += `**Độ sâu ngập dự báo:** ${depthCm.toFixed(1)} cm\n`

//   if (dbRow?.distance_km !== undefined) {
//     answer += `**Node gần nhất cách ${Number(dbRow.distance_km).toFixed(2)} km**\n`
//   }
//   answer += '\n'

//   // ── Nguồn dự liệu AI ─────────────────────────────────────────────────────────
//   if (aiResult) {
//     answer += `> 🤖 Mô hình CatBoost dự báo độ sâu ngập: **${depthCm.toFixed(1)} cm** (mức: **${riskVN(riskLevel)}**)\n\n`
//   }

//   // ── Lý do rule-based ─────────────────────────────────────────────────────────
//   if (reasons.length > 0) {
//     answer += `## Các yếu tố nguy cơ chính:\n\n`
//     reasons.forEach((r, i) => { answer += `${i + 1}. ${r}\n` })
//     answer += '\n'
//   } else {
//     answer += `> ✅ Chưa có yếu tố đơn lẻ nào vượt ngưỡng đáng lo ngại, nhưng mô hình AI vẫn tính tổng hợp toàn bộ biến.\n\n`
//   }

//   // ── Phân tích chi tiết ────────────────────────────────────────────────────────
//   answer += `## Chi tiết dữ liệu tại thời điểm này:\n\n`
//   answer += `| Nhóm | Chỉ số | Giá trị |\n|---|---|---|\n`
//   answer += `| 🌧 Mưa | Mưa hiện tại | ${features.prcp} mm |\n`
//   answer += `| 🌧 Mưa | Mưa 3h / 6h / 24h | ${features.prcp_3h} / ${features.prcp_6h} / ${features.prcp_24h} mm |\n`
//   answer += `| 🏔 Địa hình | Cao độ / Độ dốc | ${features.elevation} m / ${features.slope} |\n`
//   answer += `| 🏙 Đô thị | Bê tông hóa | ${(features.impervious_ratio * 100).toFixed(0)}% |\n`
//   answer += `| 🚰 Thoát nước | Khoảng cách cống / sông | ${features.dist_to_drain_km} km / ${features.dist_to_river_km} km |\n`
//   answer += `| 🌡 Thời tiết | Nhiệt độ / Độ ẩm | ${features.temp}°C / ${features.rhum}% |\n\n`

//   // ── Khuyến nghị ──────────────────────────────────────────────────────────────
//   answer += `## Khuyến nghị:\n\n`

//   if (riskLevel === 'severe') {
//     answer += `⛔ **NGUY HIỂM NGHIÊM TRỌNG** – Không di chuyển qua khu vực này. Liên hệ ngay cơ quan phòng chống lụt bão.\n`
//   } else if (riskLevel === 'high') {
//     answer += `⚠️ Hạn chế di chuyển, tránh các khu vực thấp trũng, hầm chui, gần sông kênh.\n`
//   } else if (riskLevel === 'medium') {
//     answer += `🟡 Di chuyển thận trọng, theo dõi thông báo thời tiết liên tục.\n`
//   } else {
//     answer += `✅ Tình trạng hiện tại khá an toàn, tiếp tục theo dõi nếu trời có dấu hiệu mưa lớn.\n`
//   }

//   answer += `\n---\n*Câu hỏi của bạn: "${question}"*`

//   return answer
// }

// // ── Route chính ───────────────────────────────────────────────────────────────

// router.post('/chat/expert', async (req, res, next) => {
//   try {
//     const { question, grid_id, lat, lng } = req.body ?? {}

//     if (!question || String(question).trim().length === 0) {
//       return res.status(400).json({ success: false, error: { message: 'Vui lòng nhập câu hỏi.' } })
//     }

//     if (String(question).length > 500) {
//       return res.status(400).json({ success: false, error: { message: 'Câu hỏi tối đa 500 ký tự.' } })
//     }

//     // 1. Lấy dữ liệu địa lý + thời tiết (Redis → CockroachDB)
//     //    Wrap bằng withDbTimeout(8s) để không treo vô hạn khi pool exhausted
//     let featureResult = null

//     try {
//       if (grid_id) {
//         featureResult = await withDbTimeout(getFeatureByGridId(String(grid_id)))
//       } else if (lat != null && lng != null) {
//         featureResult = await withDbTimeout(getFeatureByLatLng(Number(lat), Number(lng)))
//       } else {
//         // Không có grid_id/lat → thử trích xuất tên địa danh từ câu hỏi
//         const areaName = extractAreaFromQuestion(String(question))
//         if (areaName) {
//           console.log(`[ExpertChat] Phát hiện địa danh "${areaName}" trong câu hỏi, tìm node gần nhất...`)
//           // Không có tọa độ cụ thể → trả lời generic dựa trên rule-based
//           featureResult = null
//         }
//       }
//     } catch (dbErr) {
//       // Timeout hoặc DB lỗi → trả 503 rõ ràng thay vì crash thành 500
//       console.error('[ExpertChat] DB lookup lỗi:', dbErr.message)
//       const isTimeout = dbErr.code === 'LOOKUP_TIMEOUT'
//       return res.status(503).json({
//         success: false,
//         error: {
//           message: isTimeout
//             ? 'Cơ sở dữ liệu đang xử lý lượng dữ liệu lớn, vui lòng thử lại sau vài giây.'
//             : 'Hệ thống cơ sở dữ liệu đang bận. Vui lòng thử lại sau vài giây.',
//           code: isTimeout ? 'DB_TIMEOUT' : 'DB_UNAVAILABLE',
//         },
//       })
//     }

//     const dbRow = featureResult?.data ?? null

//     if (!dbRow) {
//       return res.status(200).json({
//         success: true,
//         data: {
//           answer: '🔍 Không tìm thấy dữ liệu cho vị trí này. Vui lòng thử với `grid_id` hoặc tọa độ khác.',
//           source: 'fallback',
//         },
//       })
//     }

//     // 2. Chuẩn bị features và gọi AI service
//     const features = buildAIPayload(dbRow)

//     // AI service timeout không crash route → fallback về rule-based
//     // Ưu tiên dùng kết quả đã tính sẵn bởi Cron Job (lưu trong flood_predictions)
//     // Chỉ gọi AI real-time nếu DB chưa có dữ liệu dự báo (cron chưa chạy lần nào)
//     let aiResult = null
//     let aiTimedOut = false

//     if (dbRow?.flood_depth_cm != null && dbRow?.risk_level != null) {
//       // ✅ NHANH: Dùng kết quả cron đã tính sẵn (~0ms, không gọi AI)
//       aiResult = {
//         flood_depth_cm: Number(dbRow.flood_depth_cm),
//         risk_level: String(dbRow.risk_level),
//       }
//       console.log(`[ExpertChat] Dùng kết quả cron | risk=${aiResult.risk_level} | depth=${aiResult.flood_depth_cm}cm`)
//     } else {
//       // ⚠️ FALLBACK: Gọi AI real-time chỉ khi cron chưa có dữ liệu
//       try {
//         const aiResponse = await callAIService(features)
//         if (aiResponse?.timedOut) {
//           aiTimedOut = true
//         } else if (aiResponse?.data) {
//           aiResult = aiResponse.data
//         }
//       } catch (aiErr) {
//         console.warn('[ExpertChat] AI service lỗi, dùng fallback rule-based:', aiErr.message)
//       }
//     }

//     // 3. Sinh câu trả lời chuyên sâu
//     let answer = buildExpertAnswer(String(question).trim(), features, dbRow, aiResult)

//     // Nếu AI bị timeout: chèn thông báo ở đầu (trước phân tích)
//     // vừa giải thích lý do, vừa cho user thấy kết quả vẫn hữu ích
//     if (aiTimedOut) {
//       const timeoutNotice =
//         `> ⚠️ **Mô hình AI chuyên sâu hiện đang quá tải**, nhưng dựa trên dữ liệu hiện tại, ` +
//         `tôi nhận thấy một số yếu tố đáng chú ý tại vị trí này. Phân tích Rule-based dưới đây vẫn ` +
//         `cung cấp các thông tin quan trọng:\n\n`
//       answer = timeoutNotice + answer
//     }

//     console.log(`[ExpertChat] Q="${question.substring(0, 60)}" | grid=${grid_id ?? 'n/a'} | risk=${aiResult?.risk_level ?? dbRow?.risk_level}`)

//     return res.status(200).json({
//       success: true,
//       data: {
//         answer,
//         risk_level: aiResult?.risk_level ?? dbRow?.risk_level ?? null,
//         flood_depth_cm: aiResult?.flood_depth_cm ?? dbRow?.flood_depth_cm ?? null,
//         location_name: dbRow?.location_name ?? null,
//         source: featureResult?.source ?? 'db',
//       },
//     })
//   } catch (err) {
//     // Unhandled error: log chi tiết để dễ debug, trả 500 với message rõ ràng
//     console.error('[ExpertChat] Lỗi không xử lý được:', err.message, err.stack)
//     return next(err)
//   }
// })

// module.exports = router
