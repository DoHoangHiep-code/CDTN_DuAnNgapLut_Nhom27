'use strict'

/**
 * aiExplain.service.js
 *
 * Gọi AI (Google Gemini hoặc OpenAI) để sinh giải thích nguyên nhân ngập
 * từ các feature của mô hình CatBoost.
 *
 * Nếu biến môi trường GEMINI_API_KEY hoặc OPENAI_API_KEY chưa cấu hình,
 * hàm trả về null → chatbot sẽ dùng fallback giải thích nội bộ.
 */

const axios = require('axios')

/**
 * Gọi AI sinh giải thích nguyên nhân ngập từ feature vector.
 *
 * @param {object} features - Object chứa các feature đã chuẩn hóa (buildSafeFeatures output)
 * @returns {Promise<string|null>} Chuỗi giải thích tiếng Việt hoặc null nếu lỗi/chưa cấu hình
 */
async function explainWithAI(features) {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY

  // Không có API key nào → trả null, chatbot dùng fallback
  if (!GEMINI_API_KEY && !OPENAI_API_KEY) {
    return null
  }

  const prompt = buildPrompt(features)

  try {
    if (GEMINI_API_KEY) {
      return await callGemini(GEMINI_API_KEY, prompt)
    }
    if (OPENAI_API_KEY) {
      return await callOpenAI(OPENAI_API_KEY, prompt)
    }
  } catch (err) {
    console.warn('[aiExplain] Gọi AI thất bại:', err.message)
    return null
  }

  return null
}

// ─── Prompt builder ────────────────────────────────────────────────────────────

function buildPrompt(f) {
  return `Bạn là chuyên gia thủy văn đô thị. Dựa vào dữ liệu dưới đây, hãy viết một đoạn phân tích ngắn gọn (3–5 câu) giải thích tại sao khu vực này có nguy cơ ngập lụt. Viết bằng tiếng Việt, giọng văn chuyên nghiệp nhưng dễ hiểu.

Dữ liệu đầu vào:
- Mưa hiện tại: ${f.prcp} mm
- Mưa 3 giờ: ${f.prcp_3h} mm
- Mưa 6 giờ: ${f.prcp_6h} mm
- Mưa 12 giờ: ${f.prcp_12h} mm
- Mưa 24 giờ: ${f.prcp_24h} mm
- Cường độ mưa cực đại 3h: ${f.max_prcp_3h} mm
- Nhiệt độ: ${f.temp}°C
- Độ ẩm: ${f.rhum}%
- Tốc độ gió: ${f.wspd} m/s
- Cao độ địa hình: ${f.elevation} m
- Độ dốc: ${f.slope}
- Tỷ lệ bê tông hóa: ${f.impervious_ratio}
- Khoảng cách tới hệ thống thoát nước: ${f.dist_to_drain_km} km
- Khoảng cách tới sông: ${f.dist_to_river_km} km
- Khoảng cách tới trạm bơm: ${f.dist_to_pump_km} km
- Mùa mưa: ${f.rainy_season_flag === 1 ? 'Có' : 'Không'}
- Giờ trong ngày: ${f.hour}h, Tháng: ${f.month}

Chỉ viết đoạn phân tích, không thêm tiêu đề hay gạch đầu dòng.`
}

// ─── Google Gemini ──────────────────────────────────────────────────────────────

async function callGemini(apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`

  const res = await axios.post(
    url,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 512, temperature: 0.4 },
    },
    { timeout: 15000 },
  )

  const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text
  return text ? String(text).trim() : null
}

// ─── OpenAI ─────────────────────────────────────────────────────────────────────

async function callOpenAI(apiKey, prompt) {
  const res = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 512,
      temperature: 0.4,
    },
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 15000,
    },
  )

  const text = res.data?.choices?.[0]?.message?.content
  return text ? String(text).trim() : null
}

module.exports = { explainWithAI }
