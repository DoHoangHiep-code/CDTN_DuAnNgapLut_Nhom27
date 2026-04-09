export type Role = 'user' | 'expert' | 'admin'

export type RiskLevel = 'safe' | 'medium' | 'high' | 'severe'

export type WeatherCurrent = {
  temperatureC: number
  humidityPct: number
  windKph: number
  rainfallMm: number
  observedAtIso: string
  locationName: string
}

export type WeatherForecastPoint = {
  timeIso: string
  rainfallMm: number
}

export type WeatherForecastDay = {
  dateIso: string
  minTempC: number
  maxTempC: number
  rainfallMm: number
  humidityPct: number
}

export type WeatherResponse = {
  current: WeatherCurrent
  forecast24h: WeatherForecastPoint[]
  forecast3d: WeatherForecastDay[]
  forecast7d: WeatherForecastDay[]
}

export type FloodDistrict = {
  id: string
  name: string
  risk: RiskLevel
  predictedRainfallMm: number
  // Rough polygon coordinates [lat, lng]
  polygon: [number, number][]
  updatedAtIso: string
}

export type FloodPredictionResponse = {
  updatedAtIso: string
  districts: FloodDistrict[]
}

export type ReportRow = {
  id: string
  dateIso: string
  district: string
  risk: RiskLevel
  predictedRainfallMm: number
}

export type ReportsResponse = {
  rows: {
    id: string
    createdAtIso: string
    latitude: number
    longitude: number
    reportedLevel: string
    userFullName: string | null
  }[]
}

export type DashboardForecastPoint = {
  time: string // "HH:mm" theo backend
  prcp: number // mm
  flood_depth_cm: number // cm
}

export type DashboardResponse = {
  currentWeather: { temperature: number; humidity: number; windSpeed: number }
  riskSummary: { safe: number; medium: number; high: number; severe: number; overall: RiskLevel }
  alerts: any[]
  forecast24h: DashboardForecastPoint[]
}

