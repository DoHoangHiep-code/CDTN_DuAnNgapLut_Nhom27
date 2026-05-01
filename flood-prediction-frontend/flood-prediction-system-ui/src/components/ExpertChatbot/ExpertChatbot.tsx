import { useState } from 'react'
import { askExpertChat, type FloodFeatures } from '../../services/expertChatApi'

const demoFeatures: FloodFeatures = {
  prcp: 25,
  prcp_3h: 60,
  prcp_6h: 90,
  prcp_12h: 110,
  prcp_24h: 130,
  temp: 28.5,
  rhum: 88,
  wspd: 15,
  pres: 1008,
  pressure_change_24h: -2.5,
  max_prcp_3h: 30,
  max_prcp_6h: 45,
  max_prcp_12h: 55,
  elevation: 5.2,
  slope: 1.5,
  impervious_ratio: 0.72,
  dist_to_drain_km: 0.3,
  dist_to_river_km: 1.2,
  dist_to_pump_km: 0.8,
  dist_to_main_road_km: 0.15,
  dist_to_park_km: 0.5,
  hour: 14,
  dayofweek: 2,
  month: 9,
  dayofyear: 258,
  hour_sin: -0.5,
  hour_cos: -0.866,
  month_sin: -0.866,
  month_cos: -0.5,
  rainy_season_flag: 1,
}

export default function ExpertChatbot() {
  const [question, setQuestion] = useState('Vì sao khu vực này có nguy cơ ngập cao?')
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(false)

  const handleAsk = async () => {
    try {
      setLoading(true)
      setAnswer('')

      const result = await askExpertChat(question, demoFeatures)

      setAnswer(result)
    } catch (err) {
      setAnswer(err instanceof Error ? err.message : 'Có lỗi khi hỏi chatbot')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-lg shadow p-4 mt-4">
      <h3 className="text-lg font-semibold mb-2">
        Chatbot chuyên gia ngập lụt
      </h3>

      <p className="text-sm text-gray-600 mb-2">
        Bạn có thể hỏi: Vì sao khu vực này nguy cơ cao? Mức risk dựa vào yếu tố nào?
      </p>

      <textarea
        className="w-full border rounded p-2 text-sm"
        rows={3}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
      />

      <button
        type="button"
        onClick={handleAsk}
        disabled={loading}
        className="mt-2 px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
      >
        {loading ? 'Đang phân tích...' : 'Hỏi chuyên gia'}
      </button>

      {answer && (
        <div className="mt-3 bg-gray-100 rounded p-3 whitespace-pre-wrap text-sm">
          {answer}
        </div>
      )}
    </div>
  )
}