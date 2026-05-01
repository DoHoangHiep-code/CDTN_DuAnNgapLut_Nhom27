export interface FloodFeatures {
  prcp: number
  prcp_3h: number
  prcp_6h: number
  prcp_12h: number
  prcp_24h: number
  temp: number
  rhum: number
  wspd: number
  pres: number
  pressure_change_24h: number
  max_prcp_3h: number
  max_prcp_6h: number
  max_prcp_12h: number
  elevation: number
  slope: number
  impervious_ratio: number
  dist_to_drain_km: number
  dist_to_river_km: number
  dist_to_pump_km: number
  dist_to_main_road_km: number
  dist_to_park_km: number
  hour: number
  dayofweek: number
  month: number
  dayofyear: number
  hour_sin: number
  hour_cos: number
  month_sin: number
  month_cos: number
  rainy_season_flag: number
}

export async function askExpertChat(question: string, features: FloodFeatures) {
  const response = await fetch('http://localhost:3002/api/v1/chat/expert', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      question,
      features,
    }),
  })

  const data = await response.json()

  if (!response.ok || !data.success) {
    throw new Error(data?.error?.message || 'Không gọi được chatbot chuyên gia')
  }

  return data.answer as string
}