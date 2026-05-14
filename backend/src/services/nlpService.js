'use strict'

/**
 * nlpService.js – NLP Extraction Service for AQUA Bot
 * ─────────────────────────────────────────────────────────────────────────────
 * Dual-mode NLP parser:
 *   1. Primary:  Google Gemini LLM (4s timeout, forced JSON output)
 *   2. Fallback: Enhanced regex-based parser (upgraded from detectIntent)
 *
 * Extracts structured intents + entities from raw Vietnamese user queries.
 *
 * INTENTS:
 *   ask_weather           – Weather queries (temp, rain, pressure)
 *   check_flood_status    – Real-time/recent flood status of roads/areas
 *   find_safe_route       – Routing from A to B avoiding floods
 *   predict_flood_condition – Future/hypothetical flood prediction
 *   edge_cases            – Slang, panic, greetings, general chat
 *
 * ENTITIES:
 *   location[]            – Hanoi area names
 *   time { raw, iso, offset_hours }
 *   vehicle { type, max_safe_depth_cm }
 *   weather_condition     – mưa, bão, nắng, etc.
 *
 * CACHING: Redis-backed with in-memory Map fallback. TTL 300s.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Optional dependencies (fail-safe) ────────────────────────────────────────
let redis = null
try { redis = require('./redisClient') } catch (_) { }

let GoogleGenerativeAI = null
try { ({ GoogleGenerativeAI } = require('@google/generative-ai')) } catch (_) { }

// ── Constants ────────────────────────────────────────────────────────────────

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash'
const LLM_TIMEOUT_MS = 4000   // Hard 4s fail-fast
const NLP_CACHE_TTL = 300    // 5 minutes
const TZ = 'Asia/Ho_Chi_Minh'

/** Vehicle type → maximum safe flood depth in cm */
const VEHICLE_THRESHOLDS = {
  'xe máy': 20,
  'xe đạp': 15,
  'xe đạp điện': 15,
  'ô tô gầm thấp': 25,
  'sedan': 25,
  'ô tô': 25,
  'suv': 35,
  'xe bán tải': 35,
  'xe tải': 45,
  'xe buýt': 40,
}

// ── In-memory cache fallback ─────────────────────────────────────────────────
const memoryCache = new Map()

function memoryCacheGet(key) {
  const entry = memoryCache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) { memoryCache.delete(key); return null }
  return entry.value
}

function memoryCacheSet(key, value, ttlSeconds) {
  // Cap memory cache at 500 entries to prevent unbounded growth
  if (memoryCache.size > 500) {
    const firstKey = memoryCache.keys().next().value
    memoryCache.delete(firstKey)
  }
  memoryCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
}

// ── NLP Cache Layer ──────────────────────────────────────────────────────────

async function cacheGet(key) {
  if (redis) {
    try {
      const hit = await redis.get(key)
      if (hit) return JSON.parse(hit)
    } catch (_) { }
  }
  return memoryCacheGet(key)
}

async function cacheSet(key, value, ttl = NLP_CACHE_TTL) {
  memoryCacheSet(key, value, ttl)
  if (redis) {
    try { await redis.setEx(key, ttl, JSON.stringify(value)) } catch (_) { }
  }
}

// ── Hanoi Location Keywords (expanded) ───────────────────────────────────────

const AREA_KEYWORDS = [
  // Quận nội thành
  'hoàn kiếm', 'ba đình', 'đống đa', 'hai bà trưng', 'hoàng mai',
  'thanh xuân', 'cầu giấy', 'tây hồ', 'long biên', 'hà đông',
  'bắc từ liêm', 'nam từ liêm',
  // Huyện ngoại thành
  'gia lâm', 'đông anh', 'sóc sơn', 'mê linh', 'thường tín',
  'phú xuyên', 'ứng hòa', 'mỹ đức', 'thanh oai', 'chương mỹ',
  'quốc oai', 'thạch thất', 'phúc thọ', 'đan phượng', 'hoài đức',
  // Tuyến đường / địa danh nổi bật
  'triều khúc', 'nguyễn trãi', 'thái hà', 'láng hạ', 'giảng võ',
  'kim mã', 'ngọc hà', 'đội cấn', 'phạm hùng', 'lê văn lương',
  'nguyễn xiển', 'định công', 'tân mai', 'minh khai', 'trường chinh',
  'ngã tư sở', 'ngã tư vọng', 'ô chợ dừa',
]

// ── Vehicle Extraction ───────────────────────────────────────────────────────

function extractVehicle(text) {
  const lower = text.toLowerCase()
  // Check longest keys first to match "ô tô gầm thấp" before "ô tô"
  const sortedKeys = Object.keys(VEHICLE_THRESHOLDS)
    .sort((a, b) => b.length - a.length)
  for (const key of sortedKeys) {
    if (lower.includes(key)) {
      return { type: key, max_safe_depth_cm: VEHICLE_THRESHOLDS[key] }
    }
  }
  return null
}

// ── Location Extraction ──────────────────────────────────────────────────────

function extractLocations(text) {
  const lower = text.toLowerCase()
  const found = []
  // Sort by length desc to match longer names first
  const sorted = [...AREA_KEYWORDS].sort((a, b) => b.length - a.length)
  for (const kw of sorted) {
    if (lower.includes(kw) && !found.some(f => f.includes(kw) || kw.includes(f))) {
      found.push(kw)
    }
  }
  return found
}

// ── Time Resolution (Vietnamese → ISO) ───────────────────────────────────────

function resolveTime(text) {
  const lower = text.toLowerCase()
  const now = new Date()

  // "hiện tại", "bây giờ", "lúc này", "ngay bây giờ"
  if (/(hiện tại|bây giờ|lúc này|ngay bây giờ|hiện giờ|đang)/.test(lower)) {
    return { raw: 'hiện tại', iso: now.toISOString(), offset_hours: 0 }
  }

  // "X phút nữa"
  const minuteMatch = lower.match(/(\d+)\s*phút\s*nữa/)
  if (minuteMatch) {
    const mins = parseInt(minuteMatch[1], 10)
    const target = new Date(now.getTime() + mins * 60000)
    return { raw: `${mins} phút nữa`, iso: target.toISOString(), offset_hours: +(mins / 60).toFixed(2) }
  }

  // "X tiếng/giờ nữa"
  const hourMatch = lower.match(/(\d+)\s*(?:tiếng|giờ)\s*nữa/)
  if (hourMatch) {
    const hrs = parseInt(hourMatch[1], 10)
    const target = new Date(now.getTime() + hrs * 3600000)
    return { raw: `${hrs} giờ nữa`, iso: target.toISOString(), offset_hours: hrs }
  }

  // "chiều nay" → 15:00 today
  if (/chiều\s*nay/.test(lower)) {
    const target = new Date(now); target.setHours(15, 0, 0, 0)
    if (target <= now) target.setDate(target.getDate() + 1)
    return { raw: 'chiều nay', iso: target.toISOString(), offset_hours: Math.max(0, (target - now) / 3600000) }
  }

  // "sáng mai", "sáng nay"
  if (/sáng\s*mai/.test(lower)) {
    const target = new Date(now); target.setDate(target.getDate() + 1); target.setHours(8, 0, 0, 0)
    return { raw: 'sáng mai', iso: target.toISOString(), offset_hours: (target - now) / 3600000 }
  }
  if (/sáng\s*nay/.test(lower)) {
    const target = new Date(now); target.setHours(8, 0, 0, 0)
    if (target <= now) return { raw: 'sáng nay', iso: now.toISOString(), offset_hours: 0 }
    return { raw: 'sáng nay', iso: target.toISOString(), offset_hours: (target - now) / 3600000 }
  }

  // "tối nay" → 20:00
  if (/tối\s*nay/.test(lower)) {
    const target = new Date(now); target.setHours(20, 0, 0, 0)
    if (target <= now) target.setDate(target.getDate() + 1)
    return { raw: 'tối nay', iso: target.toISOString(), offset_hours: Math.max(0, (target - now) / 3600000) }
  }

  // "trưa nay" → 12:00
  if (/trưa/.test(lower)) {
    const target = new Date(now); target.setHours(12, 0, 0, 0)
    if (target <= now) target.setDate(target.getDate() + 1)
    return { raw: 'trưa nay', iso: target.toISOString(), offset_hours: Math.max(0, (target - now) / 3600000) }
  }

  // "hôm nay"
  if (/hôm\s*nay/.test(lower)) {
    return { raw: 'hôm nay', iso: now.toISOString(), offset_hours: 0 }
  }

  // "ngày mai"
  if (/(ngày\s*mai|tomorrow)/.test(lower)) {
    const target = new Date(now); target.setDate(target.getDate() + 1); target.setHours(12, 0, 0, 0)
    return { raw: 'ngày mai', iso: target.toISOString(), offset_hours: (target - now) / 3600000 }
  }

  // "ngày kia"
  if (/(ngày\s*kia|day after)/.test(lower)) {
    const target = new Date(now); target.setDate(target.getDate() + 2); target.setHours(12, 0, 0, 0)
    return { raw: 'ngày kia', iso: target.toISOString(), offset_hours: (target - now) / 3600000 }
  }

  // "Xh" or "X:XX" explicit time
  const clockMatch = lower.match(/(\d{1,2})[h:](\d{0,2})/)
  if (clockMatch) {
    const h = parseInt(clockMatch[1], 10)
    const m = parseInt(clockMatch[2] || '0', 10)
    const target = new Date(now); target.setHours(h, m, 0, 0)
    if (target <= now) target.setDate(target.getDate() + 1)
    return { raw: `${h}:${String(m).padStart(2, '0')}`, iso: target.toISOString(), offset_hours: Math.max(0, (target - now) / 3600000) }
  }

  return null
}

// ── Weather Condition Extraction ─────────────────────────────────────────────

function extractWeatherCondition(text) {
  const lower = text.toLowerCase()
  if (/(bão|giông|lốc)/.test(lower)) return 'bão'
  if (/(mưa\s*lớn|mưa\s*to|mưa\s*rào)/.test(lower)) return 'mưa lớn'
  if (/(mưa\s*phùn|mưa\s*nhỏ)/.test(lower)) return 'mưa phùn'
  if (/mưa/.test(lower)) return 'mưa'
  if (/(nắng|trời\s*đẹp|không\s*mưa)/.test(lower)) return 'nắng'
  return null
}

// ── Legacy Intent Mapping ────────────────────────────────────────────────────

const INTENT_TO_LEGACY = {
  ask_weather: 'WEATHER_GEO_INFO',
  check_flood_status: 'CURRENT_STATUS',
  find_safe_route: 'SAFE_ADVICE',
  predict_flood_condition: 'FORECAST_4DAYS',
  edge_cases: 'UNKNOWN',
}

function mapToLegacyIntent(newIntent, entities) {
  // More nuanced mapping based on entities
  if (newIntent === 'check_flood_status') {
    if (entities.location?.length) return 'SPECIFIC_AREA'
    return 'CURRENT_STATUS'
  }
  if (newIntent === 'predict_flood_condition') {
    if (entities.time?.offset_hours > 0) return 'SPECIFIC_TIME'
    return 'FORECAST_4DAYS'
  }
  if (newIntent === 'edge_cases') {
    // Check sub-type
    const lower = (entities._rawText || '').toLowerCase()
    if (/(xin chào|hello|hi|chào)/.test(lower)) return 'GREETING'
    if (/(vì sao|tại sao|nguyên nhân|giải thích)/.test(lower)) return 'EXPLAIN_RISK'
    if (/(an toàn|nên đi|nguy hiểm không)/.test(lower)) return 'SAFE_ADVICE'
    if (/(khu vực nào|đâu nguy hiểm|nặng nhất)/.test(lower)) return 'WORST_AREA'
    return 'UNKNOWN'
  }
  return INTENT_TO_LEGACY[newIntent] || 'UNKNOWN'
}

// ═════════════════════════════════════════════════════════════════════════════
// GEMINI LLM PARSER
// ═════════════════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `You are an NLP parser for a Hanoi flood prediction chatbot called AQUA Bot.
Your ONLY job is to parse the user's Vietnamese query and return a JSON object. Output ONLY raw JSON, no explanation, no markdown.

Return this exact JSON structure:
{
  "intent": "one of: ask_weather | check_flood_status | find_safe_route | predict_flood_condition | edge_cases",
  "confidence": 0.0 to 1.0,
  "entities": {
    "location": ["array of location names mentioned, e.g. Cầu Giấy, Nguyễn Trãi"],
    "time_raw": "original time expression or null",
    "vehicle": "vehicle type mentioned or null (e.g. xe máy, ô tô, sedan, SUV)",
    "weather_condition": "weather condition or null (e.g. mưa, bão, nắng)"
  }
}

INTENT CLASSIFICATION RULES:
- ask_weather: User asks about temperature, rain amount, pressure, humidity, wind. NOT about flooding.
- check_flood_status: User asks about current/recent flooding status of a specific location or general area. Keywords: ngập, tình trạng ngập, có ngập không, mực nước.
- find_safe_route: User wants a route/path from point A to point B that avoids floods. Keywords: đường đi, tìm đường, tránh ngập, từ...đến/tới.
- predict_flood_condition: User asks about FUTURE or HYPOTHETICAL flood conditions. Keywords: dự báo, nếu mưa X mm, ngày mai có ngập, sẽ ngập không, trong tuần tới.
- edge_cases: Greetings (xin chào, hello), panic/emergency (cứu, xe chết máy, ngập quá), insults, off-topic, unclear queries, or anything that doesn't fit the other 4 intents.

LOCATION: Extract ALL Hanoi districts, streets, and landmarks mentioned. Normalize to standard Vietnamese names.
VEHICLE: Look for xe máy, ô tô, sedan, SUV, xe tải, xe buýt, xe đạp, etc. Also understand slang like "con wave" (xe máy), "4 bánh" (ô tô).
TIME: Extract time expressions like "hôm nay", "chiều nay", "30 phút nữa", "ngày mai", "hiện tại", "15h", etc.
WEATHER: Extract weather conditions like mưa, bão, nắng, giông.

EDGE CASES TO HANDLE:
- Slang: "ngập vl" = check_flood_status, "mưa quá trời" = check_flood_status
- Panic: "Cứu, xe chết máy" = edge_cases with emergency flag
- Typos: "ngâp" = "ngập", "mua" = "mưa"
- Mixed intent: Prioritize the most specific intent.`

let geminiModel = null

function getGeminiModel() {
  if (geminiModel) return geminiModel
  if (!GoogleGenerativeAI || !GEMINI_API_KEY) return null
  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
    geminiModel = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
        maxOutputTokens: 512,
      },
    })
    return geminiModel
  } catch (err) {
    console.error('[NLP] Failed to init Gemini model:', err.message)
    return null
  }
}

/**
 * Call Gemini with a strict 4s timeout using AbortController.
 * Returns parsed JSON or null on failure.
 */
async function callGemini(rawText) {
  const model = getGeminiModel()
  if (!model) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)

  try {
    const result = await model.generateContent(
      { contents: [{ role: 'user', parts: [{ text: rawText }] }] },
      { signal: controller.signal }
    )
    clearTimeout(timer)

    const responseText = result.response.text()
    // Parse – responseMimeType should ensure clean JSON, but be defensive
    const cleaned = responseText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
    return JSON.parse(cleaned)
  } catch (err) {
    clearTimeout(timer)
    if (err.name === 'AbortError') {
      console.warn(`[NLP] Gemini timed out after ${LLM_TIMEOUT_MS}ms – falling back to regex`)
    } else {
      console.warn('[NLP] Gemini error:', err.message, '– falling back to regex')
    }
    return null
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// REGEX FALLBACK PARSER
// ═════════════════════════════════════════════════════════════════════════════

function regexParse(rawText) {
  const m = rawText.toLowerCase()

  let intent = 'edge_cases'
  let confidence = 0.7

  // ── find_safe_route ──
  if (/(tìm đường|đường đi|từ\s+.+\s+(đến|tới|sang)|tránh ngập|lộ trình|chỉ đường)/.test(m)) {
    intent = 'find_safe_route'
    confidence = 0.85
  }
  // ── ask_weather (NOT flood) ──
  else if (/(lượng mưa|nhiệt độ|áp suất|độ ẩm|gió|thời tiết|bê tông hóa|cao độ|độ dốc)/.test(m)
    && !/(ngập|lũ|lụt)/.test(m)) {
    intent = 'ask_weather'
    confidence = 0.80
  }
  // ── predict_flood_condition (future/hypothetical) ──
  else if (/(dự báo|nếu mưa|sẽ ngập|có ngập không.+mai|ngày mai|ngày kia|tuần tới|sắp tới|4 ngày|96 giờ|\d+\s*mm)/.test(m)) {
    intent = 'predict_flood_condition'
    confidence = 0.80
  }
  // ── check_flood_status (current/recent) ──
  else if (/(ngập|tình trạng|mực nước|đang ngập|hiện tại|bây giờ|lúc này|có ngập|nước lên)/.test(m)) {
    intent = 'check_flood_status'
    confidence = 0.80
  }
  // ── edge_cases: greetings ──
  else if (/(?:^|\s)(xin chào|hello|hi|chào bot|chào aqua|hey)(?:\s|$|!)/i.test(m)) {
    intent = 'edge_cases'
    confidence = 0.95
  }
  // ── edge_cases: panic/emergency ──
  else if (/(cứu|chết máy|ngập quá|xe ngập|mắc kẹt|không thoát|sos|giúp tôi|help)/.test(m)) {
    intent = 'edge_cases'
    confidence = 0.90
  }
  // ── check_flood_status: location-only queries ──
  else if (extractLocations(rawText).length > 0) {
    intent = 'check_flood_status'
    confidence = 0.65
  }
  // ── ask_weather with flood metrics ──
  else if (/(lượng mưa|áp suất|độ dốc|cao độ|mực nước)/.test(m)) {
    intent = 'ask_weather'
    confidence = 0.75
  }

  return { intent, confidence }
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT: parseUserQuery
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Parse a raw Vietnamese user query into structured intent + entities.
 *
 * Flow: Cache → Gemini LLM (4s timeout) → Regex fallback
 *
 * @param {string} rawText – the user's message
 * @returns {Promise<{
 *   intent: string,
 *   confidence: number,
 *   entities: {
 *     location: string[],
 *     time: { raw: string, iso: string, offset_hours: number } | null,
 *     vehicle: { type: string, max_safe_depth_cm: number } | null,
 *     weather_condition: string | null
 *   },
 *   legacyIntent: string,
 *   source: 'cache' | 'gemini' | 'regex'
 * }>}
 */
async function parseUserQuery(rawText) {
  const normalizedKey = `nlp:${rawText.trim().toLowerCase().replace(/\s+/g, ' ')}`

  // ── 1. Check NLP cache ──
  const cached = await cacheGet(normalizedKey)
  if (cached) {
    return { ...cached, source: 'cache' }
  }

  // ── 2. Extract entities (always, regardless of LLM/regex) ──
  const locations = extractLocations(rawText)
  const time = resolveTime(rawText)
  const vehicle = extractVehicle(rawText)
  const weather = extractWeatherCondition(rawText)

  let intent = null
  let confidence = 0
  let source = 'regex'

  // ── 3. Try Gemini LLM ──
  const geminiResult = await callGemini(rawText)
  if (geminiResult && geminiResult.intent) {
    const validIntents = ['ask_weather', 'check_flood_status', 'find_safe_route', 'predict_flood_condition', 'edge_cases']
    if (validIntents.includes(geminiResult.intent)) {
      intent = geminiResult.intent
      confidence = Number(geminiResult.confidence) || 0.85
      source = 'gemini'

      // Merge LLM-extracted locations with regex-extracted ones
      if (Array.isArray(geminiResult.entities?.location)) {
        for (const loc of geminiResult.entities.location) {
          const lower = loc.toLowerCase()
          if (!locations.some(l => l === lower)) locations.push(lower)
        }
      }
    }
  }

  // ── 4. Fallback to regex if Gemini failed/returned invalid ──
  if (!intent) {
    const regexResult = regexParse(rawText)
    intent = regexResult.intent
    confidence = regexResult.confidence
    source = 'regex'
  }

  // ── 5. Build result ──
  const entities = {
    location: locations,
    time,
    vehicle,
    weather_condition: weather,
    _rawText: rawText,  // kept for legacy mapping
  }

  const legacyIntent = mapToLegacyIntent(intent, entities)

  const result = {
    intent,
    confidence,
    entities,
    legacyIntent,
    source,
  }

  // ── 6. Cache the result ──
  await cacheSet(normalizedKey, result, NLP_CACHE_TTL)

  return result
}

// ═════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═════════════════════════════════════════════════════════════════════════════

module.exports = {
  parseUserQuery,
  // Exported for reuse by routingService and tests
  VEHICLE_THRESHOLDS,
  AREA_KEYWORDS,
  extractLocations,
  extractVehicle,
  resolveTime,
  extractWeatherCondition,
  mapToLegacyIntent,
}
