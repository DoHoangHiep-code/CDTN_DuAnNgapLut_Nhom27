'use strict'

/**
 * OpenWeatherService – gọi OpenWeatherMap API theo tọa độ.
 *
 * Endpoints sử dụng:
 *   • Current Weather : GET /data/2.5/weather
 *   • 5-Day Forecast  : GET /data/2.5/forecast  (40 data points × 3h = 5 ngày)
 *
 * Cấu hình: đặt OPENWEATHER_API_KEY vào file .env
 * Fallback : nếu key không tồn tại hoặc API lỗi → trả null (không crash server)
 */

const axios = require('axios')

const OWM_API_KEY = () => process.env.OPENWEATHER_API_KEY
const OWM_BASE = 'https://api.openweathermap.org/data/2.5'
const OWM_TIMEOUT_MS = 8000   // 8 giây

// ─── Kiểm tra API key ────────────────────────────────────────────────────────

function _hasValidKey() {
  const key = OWM_API_KEY()
  return key && key !== 'your_openweathermap_api_key_here'
}

// ─── Xử lý lỗi chung ─────────────────────────────────────────────────────────

function _handleAxiosError(err, label) {
  if (err.code === 'ECONNABORTED') {
    console.error(`[OWM/${label}] Timeout sau ${OWM_TIMEOUT_MS}ms.`)
  } else if (err.response?.status === 401) {
    console.error(`[OWM/${label}] API key không hợp lệ (HTTP 401).`)
  } else if (err.response?.status === 429) {
    console.error(`[OWM/${label}] Vượt rate limit (HTTP 429).`)
  } else {
    console.error(`[OWM/${label}] Lỗi:`, err.message)
  }
}

// ─── 1. Current Weather ───────────────────────────────────────────────────────

/**
 * Lấy dữ liệu thời tiết hiện tại từ OpenWeatherMap theo tọa độ GPS.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<{
 *   rain1h: number, humidity: number, clouds: number, temp: number,
 *   description: string, windSpeed: number, pressure: number
 * } | null>}
 */
async function getWeatherByCoords(lat, lon) {
  if (!_hasValidKey()) {
    console.warn('[OWM/Current] OPENWEATHER_API_KEY chưa được cấu hình trong .env')
    return null
  }

  try {
    const res = await axios.get(`${OWM_BASE}/weather`, {
      params: {
        lat,
        lon,
        appid: OWM_API_KEY(),
        units: 'metric',
        lang: 'vi',
      },
      timeout: OWM_TIMEOUT_MS,
    })

    const d = res.data
    return {
      rain1h: d?.rain?.['1h'] ?? 0,
      humidity: d?.main?.humidity ?? 0,
      clouds: d?.clouds?.all ?? 0,
      temp: d?.main?.temp ?? 0,
      feels_like: d?.main?.feels_like ?? 0,
      description: d?.weather?.[0]?.description ?? 'Không rõ',
      windSpeed: d?.wind?.speed ?? 0,   // m/s
      windDeg: d?.wind?.deg ?? 0,
      pressure: d?.main?.pressure ?? 1013, // hPa
      visibility: d?.visibility ?? 10000,
    }
  } catch (err) {
    _handleAxiosError(err, 'Current')
    return null
  }
}

// ─── 2. 5-Day / 3-Hour Forecast ──────────────────────────────────────────────

/**
 * Lấy dự báo 5 ngày (40 data points × 3h) từ OWM /data/2.5/forecast.
 *
 * Mỗi phần tử trong mảng trả về có shape:
 * {
 *   timeIso:   string   – ISO timestamp của đầu khoảng 3h
 *   temp:      number   – °C (giữa khoảng 3h)
 *   humidity:  number   – %
 *   rain3h:    number   – mm mưa trong 3 giờ (rain["3h"])
 *   pressure:  number   – hPa
 *   windSpeed: number   – m/s
 *   clouds:    number   – % mây che
 *   description: string
 * }
 *
 * Tại sao chọn endpoint này:
 *   - Miễn phí, hoạt động trên mọi gói OWM kể cả Developer.
 *   - Trả `rain["3h"]` đã tích lũy sẵn → tính prcp_3h, prcp_6h, prcp_12h, prcp_24h
 *     cho AI chỉ cần cộng các steps, không phải interpolate thêm.
 *   - 40 data points × 3h = đủ 5 ngày dự báo.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<Array<object>|null>}
 */
async function getOWMForecast5d(lat, lon) {
  if (!_hasValidKey()) {
    console.warn('[OWM/Forecast5d] OPENWEATHER_API_KEY chưa được cấu hình trong .env')
    return null
  }

  try {
    const res = await axios.get(`${OWM_BASE}/forecast`, {
      params: {
        lat,
        lon,
        appid: OWM_API_KEY(),
        units: 'metric',
        lang: 'vi',
        cnt: 40,   // tối đa 40 steps × 3h = 5 ngày
      },
      timeout: OWM_TIMEOUT_MS,
    })

    const list = res.data?.list
    if (!Array.isArray(list) || !list.length) return null

    return list.map((item) => ({
      timeIso: item.dt_txt + ':00+07:00',   // server UTC → giữ nguyên, frontend parse
      timeUtc: new Date(item.dt * 1000),     // Date object UTC
      temp: item.main?.temp ?? 28,
      feels_like: item.main?.feels_like ?? 28,
      tempMin: item.main?.temp_min ?? 26,
      tempMax: item.main?.temp_max ?? 32,
      humidity: item.main?.humidity ?? 70,
      rain3h: item.rain?.['3h'] ?? 0,  // mm tích lũy 3 giờ
      pressure: item.main?.pressure ?? 1010,
      windSpeed: item.wind?.speed ?? 0,   // m/s
      windDeg: item.wind?.deg ?? 0,
      clouds: item.clouds?.all ?? 0,
      visibility: item.visibility ?? 10000,
      description: item.weather?.[0]?.description ?? 'Không rõ',
      icon: item.weather?.[0]?.icon ?? '',
    }))
  } catch (err) {
    _handleAxiosError(err, 'Forecast5d')
    return null
  }
}

// ─── 3. Helper: Aggregate 3h points → daily summary ──────────────────────────

/**
 * Gom nhóm mảng 3h data points từ OWM thành mảng daily (theo ngày ICT).
 *
 * @param {Array<object>} points – output của getOWMForecast5d()
 * @param {number}        [maxDays=5]
 * @returns {Array<{
 *   dateIso: string, minTempC: number, maxTempC: number,
 *   rainfallMm: number, humidityPct: number,
 *   points: Array  – data points gốc của ngày đó (để AI inference)
 * }>}
 */
function aggregateToDaily(points, maxDays = 5) {
  if (!points || !points.length) return []

  // Nhóm theo date_only (ICT = UTC+7)
  const byDay = new Map()
  for (const p of points) {
    const ictMs = p.timeUtc.getTime() + 7 * 3600 * 1000
    const dateIso = new Date(ictMs).toISOString().slice(0, 10)
    if (!byDay.has(dateIso)) byDay.set(dateIso, [])
    byDay.get(dateIso).push(p)
  }

  const days = []
  for (const [dateIso, pts] of byDay.entries()) {
    if (days.length >= maxDays) break
    days.push({
      dateIso,
      minTempC: Math.round(Math.min(...pts.map(p => p.tempMin)) * 10) / 10,
      maxTempC: Math.round(Math.max(...pts.map(p => p.tempMax)) * 10) / 10,
      rainfallMm: Math.round(pts.reduce((s, p) => s + p.rain3h, 0) * 10) / 10,
      humidityPct: Math.round(pts.reduce((s, p) => s + p.humidity, 0) / pts.length),
      points: pts,
    })
  }

  return days
}

// ─── 4. One Call API 3.0 ──────────────────────────────────────────────────────

const OWM_ONECALL_BASE = 'https://api.openweathermap.org/data/3.0'

/**
 * Lấy dữ liệu thời tiết (current, hourly, daily) từ OpenWeatherMap One Call 3.0.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<object|null>}
 */
async function getOWMOneCall(lat, lon) {
  if (!_hasValidKey()) {
    console.warn('[OWM/OneCall] OPENWEATHER_API_KEY chưa được cấu hình trong .env')
    return null
  }

  try {
    const res = await axios.get(`${OWM_ONECALL_BASE}/onecall`, {
      params: {
        lat,
        lon,
        appid: OWM_API_KEY(),
        units: 'metric',
        lang: 'vi',
        exclude: 'minutely,alerts'
      },
      timeout: OWM_TIMEOUT_MS,
    })

    return res.data
  } catch (err) {
    _handleAxiosError(err, 'OneCall')
    return null
  }
}

module.exports = { getWeatherByCoords, getOWMForecast5d, aggregateToDaily, getOWMOneCall }
