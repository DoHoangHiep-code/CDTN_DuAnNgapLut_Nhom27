import { useCallback, useEffect, useRef, useState } from 'react'
import { CloudRain, Droplets, Cloud, Brain, RefreshCw, Loader2, Wind, Database } from 'lucide-react'
import { getForecastLatest } from '../services/api'
import { FloodReportModal } from './FloodReportModal'
import { cn } from '../utils/cn'
import type { FloodLevel } from './FloodReportModal'
import toast from 'react-hot-toast'

// ──────────────────────────────────────────────────────────────────────
// Kiểu dữ liệu – khớp với schema trả về từ GET /api/v1/forecasts/latest
// ──────────────────────────────────────────────────────────────────────
type RiskLevel = 'safe' | 'medium' | 'high' | 'severe'

type ForecastData = {
  /** Nguồn dữ liệu: 'database' = từ Cronjob đã tính, 'realtime' = gọi AI tức thời */
  source: 'database' | 'realtime'
  data: {
    location: string
    time: string
    weather: {
      temp: number
      prcp: number
      rhum: number
      clouds: number
      description: string
    }
    prediction: {
      flood_depth_cm: number
      risk_level: RiskLevel
      explanation: string | null
      label: 0 | 1
      warningText: string
    }
    usingLiveWeather: boolean
  }
}

type Props = {
  /** Vĩ độ tâm bản đồ hiện tại */
  lat: number
  /** Kinh độ tâm bản đồ hiện tại */
  lon: number
}

// ──────────────────────────────────────────────────────────────────────
// Debounce hook – tránh gọi API liên tục khi di chuyển map
// ──────────────────────────────────────────────────────────────────────
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

// ──────────────────────────────────────────────────────────────────────
// Màu sắc & nhãn theo risk_level (4 mức từ DB)
// ──────────────────────────────────────────────────────────────────────
const RISK_CONFIG: Record<RiskLevel, {
  gradient: string
  badgeText: string
  badgeIcon: string
  pulse: boolean
}> = {
  safe: {
    gradient: 'from-emerald-600 via-teal-600 to-green-700',
    badgeText: 'AN TOÀN',
    badgeIcon: '🟢',
    pulse: false,
  },
  medium: {
    gradient: 'from-amber-500 via-yellow-500 to-orange-500',
    badgeText: 'NGUY CƠ THẤP',
    badgeIcon: '🟡',
    pulse: false,
  },
  high: {
    gradient: 'from-orange-600 via-red-500 to-rose-600',
    badgeText: 'NGUY CƠ CAO',
    badgeIcon: '🟠',
    pulse: true,
  },
  severe: {
    gradient: 'from-rose-700 via-red-800 to-red-900',
    badgeText: 'NGUY HIỂM',
    badgeIcon: '🔴',
    pulse: true,
  },
}

// ──────────────────────────────────────────────────────────────────────
// Stat item trong grid thông số thời tiết
// ──────────────────────────────────────────────────────────────────────
function WeatherStat({
  icon,
  label,
  value,
  unit,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: number | string
  unit: string
  color: string
}) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl bg-white/10 p-3 backdrop-blur-sm">
      <div className={cn('flex h-8 w-8 items-center justify-center rounded-full', color)}>
        {icon}
      </div>
      <span className="text-[11px] font-medium text-white/70">{label}</span>
      <span className="text-sm font-extrabold text-white">
        {typeof value === 'number' ? value.toFixed(1) : value}
        <span className="ml-0.5 text-[10px] font-normal text-white/60">{unit}</span>
      </span>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Badge hiển thị nguồn dữ liệu
// ──────────────────────────────────────────────────────────────────────
function SourceBadge({ source }: { source: 'database' | 'realtime' }) {
  return (
    <div className={cn(
      'flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold',
      source === 'database'
        ? 'bg-emerald-400/20 text-emerald-200'
        : 'bg-blue-400/20 text-blue-200'
    )}>
      <Database className="h-2.5 w-2.5" />
      {source === 'database' ? 'Từ DB' : 'Realtime AI'}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Component chính: FloodWarningCard
// ──────────────────────────────────────────────────────────────────────
export function FloodWarningCard({ lat, lon }: Props) {
  const [forecast, setForecast] = useState<ForecastData | null>(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [collapsed, setCollapsed]   = useState(true) // mặc định thu gọn
  const [hovered, setHovered]       = useState(false)

  // Khi hover → mở full; rời chuột → thu gọn lại (trừ khi user đã pin mở bằng nút)
  const isExpanded = hovered || !collapsed
  const abortRef = useRef<AbortController | null>(null)

  // Debounce tọa độ 900ms để tránh spam API khi drag map
  const debouncedLat = useDebounce(lat, 900)
  const debouncedLon = useDebounce(lon, 900)

  // ── Fetch dự báo mới nhất từ DB (endpoint /forecasts/latest) ──
  const fetchData = useCallback(async () => {
    // Hủy request cũ nếu đang chạy
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)

    try {
      const result = await getForecastLatest(debouncedLat, debouncedLon)

      // Kiểm tra request chưa bị hủy trước khi set state
      if (!controller.signal.aborted) {
        if (result?.data) {
          setForecast(result as ForecastData)
        } else {
          setError('Dữ liệu trả về không hợp lệ.')
        }
      }
    } catch (err: any) {
      if (!controller.signal.aborted) {
        // 404 = chưa có data trong DB (cron chưa chạy)
        if (err?.response?.status === 404) {
          setError('Chưa có dữ liệu dự báo. Vui lòng kích hoạt Cronjob.')
        } else {
          setError('Không thể tải dữ liệu dự đoán.')
        }
        console.error('[FloodWarningCard] Fetch error:', err.message)
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false)
      }
    }
  }, [debouncedLat, debouncedLon])

  useEffect(() => {
    fetchData()
    return () => abortRef.current?.abort()
  }, [fetchData])

  // ── Gửi báo cáo ngập ──
  async function handleSubmitReport(payload: {
    lat: number
    lng: number
    level: FloodLevel
    note: string
  }) {
    const { apiV1 } = await import('../utils/axiosConfig')
    await apiV1.post('/reports/actual-flood', {
      lat:      payload.lat,
      lng:      payload.lng,
      severity: payload.level,
      note:     payload.note,
    })
    toast.success('Báo cáo ngập đã được gửi. Cảm ơn bạn!')
  }

  // ── Tính các giá trị hiển thị ──
  const pred     = forecast?.data?.prediction
  const weather  = forecast?.data?.weather
  const riskLevel: RiskLevel = pred?.risk_level ?? 'safe'
  const riskCfg  = RISK_CONFIG[riskLevel]
  const isFlood  = pred?.label === 1
  const isNoData = !forecast && !loading

  // Gradient nền dựa theo risk_level (4 màu thay vì chỉ 2)
  const bgClass = loading || isNoData
    ? 'from-slate-700 via-slate-600 to-slate-700'
    : riskCfg.gradient

  // Format thời gian dự báo
  const forecastTimeLabel = forecast?.data?.time
    ? new Intl.DateTimeFormat('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
      }).format(new Date(forecast.data.time))
    : null

  return (
    <>
      {/* ── Card nổi trên bản đồ ── */}
      <div
        className={cn(
          'absolute bottom-16 left-4 z-[1000] w-72 overflow-hidden rounded-2xl shadow-2xl shadow-black/40',
          'border border-white/20 bg-gradient-to-br backdrop-blur-xl transition-all duration-500',
          bgClass,
        )}
        style={{ pointerEvents: 'auto' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <div className="flex items-center gap-2 min-w-0">

            {/* Badge trạng thái – đổi theo 4 mức risk */}
            {loading ? (
              <div className="flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1">
                <Loader2 className="h-3 w-3 animate-spin text-white" />
                <span className="text-[11px] font-bold text-white">Đang phân tích…</span>
              </div>
            ) : error ? (
              <div className="rounded-full bg-white/20 px-2.5 py-1">
                <span className="text-[11px] font-bold text-white/80">⚠ {error}</span>
              </div>
            ) : pred ? (
              <div className={cn(
                'relative flex items-center gap-1.5 rounded-full bg-white/25 px-2.5 py-1',
              )}>
                {/* Vòng pulse chỉ hiện khi nguy cơ high/severe */}
                {riskCfg.pulse && (
                  <span className="absolute -left-0.5 -top-0.5 h-full w-full animate-ping rounded-full bg-red-400/50" />
                )}
                <span className="relative text-[11px] font-bold text-white">
                  {riskCfg.badgeIcon} {riskCfg.badgeText}
                </span>
              </div>
            ) : null}
          </div>

          {/* Nút làm mới + thu gọn */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              type="button"
              onClick={fetchData}
              disabled={loading}
              title="Làm mới dự đoán"
              className="rounded-lg p-1 text-white/70 hover:bg-white/20 hover:text-white transition"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </button>
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              title={collapsed ? 'Ghim mở' : 'Bỏ ghim'}
              className="rounded-lg p-1 text-white/70 hover:bg-white/20 hover:text-white transition text-sm leading-none"
            >
              {collapsed ? '📌' : '✕'}
            </button>
          </div>
        </div>

        {/* ── Body – mở khi hover hoặc khi user pin mở ── */}
        {isExpanded && (
          <div className="px-4 pb-4 space-y-3">

            {/* Warning text lớn + depth */}
            {!loading && pred && (
              <div className="space-y-0.5">
                <p className="text-sm font-extrabold text-white leading-snug">
                  {pred.warningText}
                  {pred.flood_depth_cm > 0 && (
                    <span className="ml-1 text-xs font-normal text-white/70">
                      (~{pred.flood_depth_cm}cm)
                    </span>
                  )}
                </p>

                {/* Explanation từ DB */}
                {pred.explanation && (
                  <p className="text-[11px] text-white/75 leading-snug italic">
                    {pred.explanation}
                  </p>
                )}
              </div>
            )}

            {/* Skeleton loading */}
            {loading && !forecast && (
              <div className="space-y-2">
                <div className="h-3 w-2/3 rounded bg-white/20 animate-pulse" />
                <div className="h-3 w-1/2 rounded bg-white/20 animate-pulse" />
              </div>
            )}

            {/* ── Grid 4 thông số thời tiết ── */}
            {weather && (
              <div className="grid grid-cols-4 gap-1.5">
                <WeatherStat
                  icon={<CloudRain className="h-4 w-4 text-sky-200" />}
                  label="Mưa"
                  value={weather.prcp}
                  unit="mm"
                  color="bg-sky-500/30"
                />
                <WeatherStat
                  icon={<Droplets className="h-4 w-4 text-blue-200" />}
                  label="Ẩm"
                  value={weather.rhum}
                  unit="%"
                  color="bg-blue-500/30"
                />
                <WeatherStat
                  icon={<Cloud className="h-4 w-4 text-slate-200" />}
                  label="Mây"
                  value={weather.clouds}
                  unit="%"
                  color="bg-slate-500/30"
                />
                <WeatherStat
                  icon={<Wind className="h-4 w-4 text-violet-200" />}
                  label="Nhiệt"
                  value={weather.temp}
                  unit="°C"
                  color="bg-violet-500/30"
                />
              </div>
            )}

            {/* ── Mô tả thời tiết + thời gian dự báo ── */}
            {weather && (
              <div className="flex items-center justify-between text-[11px] text-white/60">
                <span className="capitalize">{weather.description}</span>
                {forecastTimeLabel && (
                  <span className="font-semibold text-white/80">📅 {forecastTimeLabel}</span>
                )}
              </div>
            )}

            {/* ── Footer: nguồn dữ liệu + AI badge ── */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1 text-[10px] text-white/50">
                <Brain className="h-3 w-3 flex-shrink-0" />
                <span>CatBoost AI</span>
                {forecast?.data?.usingLiveWeather === false && (
                  <span className="ml-1 rounded bg-white/10 px-1 py-0.5">offline</span>
                )}
              </div>
              {forecast && <SourceBadge source={forecast.source} />}
            </div>

            {/* Divider */}
            <div className="h-px bg-white/15" />

            {/* ── Nút báo cáo tình trạng thực tế ── */}
            <button
              id="flood-warning-card-report-btn"
              type="button"
              onClick={() => setReportOpen(true)}
              className={cn(
                'w-full flex items-center justify-center gap-2 rounded-xl py-2.5 px-4',
                'text-sm font-bold transition active:scale-95',
                'bg-white/95 hover:bg-white shadow-lg shadow-black/20',
                isFlood ? 'text-rose-700' : 'text-emerald-700',
              )}
            >
              📝 Báo cáo tình trạng thực tế
            </button>
          </div>
        )}
      </div>

      {/* ── Modal báo cáo ── */}
      <FloodReportModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        onSubmit={handleSubmitReport}
      />
    </>
  )
}
