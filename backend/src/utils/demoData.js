// Các hàm tạo dữ liệu "demo" để tương thích UI hiện tại.
// Lý do tồn tại: Frontend ban đầu dùng mocks (setupDevMocks.ts) trả về shape đơn giản,
// trong khi backend thật trả về {success, data}. Khi chưa refactor UI hoàn toàn theo backend,
// ta cung cấp dữ liệu demo/compat để tránh 404/400 và không làm UI crash.

function isoNow() {
  return new Date().toISOString()
}

function round(n, digits = 1) {
  const m = 10 ** digits
  return Math.round(n * m) / m
}

function riskFromRain(mm) {
  if (mm < 10) return 'safe'
  if (mm < 30) return 'medium'
  if (mm < 60) return 'high'
  return 'severe'
}

function hashToInt(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

function buildWeather(districtName) {
  const now = new Date()
  const seed = hashToInt(String(districtName || 'city').trim())
  const offset = (seed % 21) - 10 // -10..10
  const baseRain = 8 + (now.getHours() % 6) * 4 + offset * 0.25
  const currentRain = round(baseRain + 3, 1)
  const tempOffset = offset * 0.15
  const windOffset = offset * 0.12
  const humidityOffset = offset * 0.6

  const current = {
    temperatureC: round(26 + Math.sin(now.getHours() / 24) * 3 + tempOffset, 1),
    humidityPct: Math.round(72 + (now.getHours() % 5) * 3 + humidityOffset),
    windKph: round(9 + (now.getHours() % 4) * 2 + windOffset, 1),
    rainfallMm: currentRain,
    observedAtIso: now.toISOString(),
    locationName: (districtName?.trim() || 'City Center') + '',
  }

  const forecast24h = Array.from({ length: 24 }, (_, i) => {
    const t = new Date(now.getTime() + i * 60 * 60 * 1000)
    const mm = round(Math.max(0, baseRain + Math.sin((i / 24) * Math.PI * 2) * 8 + (i % 4) * 1.2), 1)
    return { timeIso: t.toISOString(), rainfallMm: mm }
  })

  const forecast7d = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000)
    const rainfall = round(18 + i * 6 + (d.getDay() % 3) * 5 + (i % 2) * 3 + offset * 0.35, 1)
    return {
      dateIso: d.toISOString().slice(0, 10),
      minTempC: round(23 + i * 0.5 + tempOffset * 0.25, 1),
      maxTempC: round(30 + i * 0.5 + tempOffset * 0.25, 1),
      rainfallMm: rainfall,
      humidityPct: Math.min(95, 70 + i * 6 + (i % 3) * 2 + humidityOffset * 0.25),
    }
  })

  const forecast3d = forecast7d.slice(0, 3)
  return { current, forecast24h, forecast3d, forecast7d }
}

function buildFloodPrediction() {
  // Polygon demo quanh tọa độ Hà Nội (tương tự FE mocks) để LocationSearch/MiniFloodMap hoạt động
  const base = { lat: 21.0278, lng: 105.8342 }
  const defs = [
    { id: 'd_01', name: 'Ba Dinh', offLat: 0.015, offLng: -0.01, rain: 12 },
    { id: 'd_02', name: 'Hoan Kiem', offLat: 0.0, offLng: 0.01, rain: 28 },
    { id: 'd_03', name: 'Dong Da', offLat: 0.02, offLng: 0.02, rain: 46 },
    { id: 'd_04', name: 'Cau Giay', offLat: 0.03, offLng: -0.03, rain: 65 },
    { id: 'd_05', name: 'Hai Ba Trung', offLat: -0.02, offLng: 0.03, rain: 34 },
  ]

  const districts = defs.map((d) => {
    const lat = base.lat + d.offLat
    const lng = base.lng + d.offLng
    const size = 0.012
    const polygon = [
      [lat - size, lng - size],
      [lat - size, lng + size],
      [lat + size, lng + size],
      [lat + size, lng - size],
    ]
    return {
      id: d.id,
      name: d.name,
      predictedRainfallMm: round(d.rain, 1),
      risk: riskFromRain(d.rain),
      polygon,
      updatedAtIso: isoNow(),
    }
  })

  return { updatedAtIso: isoNow(), districts }
}

module.exports = { buildWeather, buildFloodPrediction }

