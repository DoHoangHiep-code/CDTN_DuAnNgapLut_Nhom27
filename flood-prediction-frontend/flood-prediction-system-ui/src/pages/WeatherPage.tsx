import { useRef, useState } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, CloudRain, Droplets, MapPin, RefreshCcw, Sun, Wind } from 'lucide-react'
import type { LatLngExpression } from 'leaflet'
import { useTranslation } from 'react-i18next'
import { Spinner } from '../components/Spinner'
import { ErrorState } from '../components/ErrorState'
import { MiniFloodMap } from '../components/MiniFloodMap'
import { LocationSearch } from '../components/LocationSearch'
import { useAsync } from '../hooks/useAsync'
import { getWeather, getForecast7d } from '../services/api'
import type { WeatherForecastDay } from '../utils/types'
import { cn } from '../utils/cn'

type WeatherKind = 'rain' | 'sun' | 'flood'

function kindFromRainfall(mm: number): WeatherKind {
  if (mm >= 60) return 'flood'
  if (mm >= 25) return 'rain'
  return 'sun'
}

function centroid(poly: [number, number][]): LatLngExpression {
  const avg = poly.reduce((acc, p) => ({ lat: acc.lat + p[0], lng: acc.lng + p[1] }), { lat: 0, lng: 0 })
  return [avg.lat / poly.length, avg.lng / poly.length]
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('vi-VN', { weekday: 'short', day: 'numeric', month: 'numeric' })
}

function formatDateFull(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' })
}

const KIND_CONFIG: Record<WeatherKind, {
  gradient: string
  iconColor: string
  badgeColor: string
  label: string
  Icon: typeof CloudRain
}> = {
  rain: {
    gradient: 'from-sky-500 to-blue-600',
    iconColor: 'text-sky-500',
    badgeColor: 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300',
    label: 'Mưa',
    Icon: CloudRain,
  },
  sun: {
    gradient: 'from-amber-400 to-orange-500',
    iconColor: 'text-amber-500',
    badgeColor: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
    label: 'Nắng',
    Icon: Sun,
  },
  flood: {
    gradient: 'from-rose-500 to-red-600',
    iconColor: 'text-rose-500',
    badgeColor: 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300',
    label: 'Nguy cơ ngập',
    Icon: AlertTriangle,
  },
}

const RISK_CONFIG: Record<string, { label: string; dot: string; text: string }> = {
  safe:   { label: 'An toàn',    dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
  medium: { label: 'Trung bình', dot: 'bg-yellow-500',  text: 'text-yellow-600 dark:text-yellow-400' },
  high:   { label: 'Cao',        dot: 'bg-orange-500',  text: 'text-orange-600 dark:text-orange-400' },
  severe: { label: 'Nguy hiểm',  dot: 'bg-red-500',     text: 'text-red-600 dark:text-red-400' },
}

function WeatherForecastCard({ d, aiDay, isFirst }: {
  d: WeatherForecastDay
  aiDay?: { flood_depth_cm: number; risk_level: string } | null
  isFirst?: boolean
}) {
  const kind = kindFromRainfall(d.rainfallMm)
  const cfg = KIND_CONFIG[kind]
  const riskCfg = aiDay ? (RISK_CONFIG[aiDay.risk_level] ?? RISK_CONFIG.safe) : null
  const Icon = cfg.Icon

  return (
    <div className={cn(
      'relative flex h-full w-full flex-col overflow-hidden rounded-2xl border transition-all duration-300',
      'hover:-translate-y-1 hover:shadow-xl',
      isFirst
        ? 'border-sky-200 bg-gradient-to-b from-sky-50 to-white shadow-md dark:border-sky-800 dark:from-sky-950/30 dark:to-slate-900'
        : 'border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900',
    )}>
      {/* Color bar top */}
      <div className={cn('h-1.5 w-full bg-gradient-to-r', cfg.gradient)} />

      <div className="flex flex-1 flex-col gap-3 p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              {formatDate(d.dateIso)}
            </div>
            <span className={cn('mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', cfg.badgeColor)}>
              <Icon className="h-3 w-3" />
              {cfg.label}
            </span>
          </div>
          <Icon className={cn('h-8 w-8 flex-shrink-0', cfg.iconColor)} />
        </div>

        {/* Temp big */}
        <div className="text-center">
          <div className="text-2xl font-black text-slate-800 dark:text-slate-100">
            {d.minTempC}° <span className="text-slate-400">–</span> {d.maxTempC}°C
          </div>
        </div>

        {/* Stats */}
        <div className="space-y-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
              <CloudRain className="h-3.5 w-3.5 text-sky-500" /> Lượng mưa
            </span>
            <span className="font-bold text-sky-600 dark:text-sky-400">{d.rainfallMm} mm</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
              <Droplets className="h-3.5 w-3.5 text-indigo-500" /> Độ ẩm
            </span>
            <span className="font-bold text-indigo-600 dark:text-indigo-400">{d.humidityPct}%</span>
          </div>
          {aiDay && riskCfg && (
            <>
              <div className="flex items-center justify-between border-t border-slate-200/60 pt-2 text-xs dark:border-slate-700/60">
                <span className="text-slate-500 dark:text-slate-400">Độ ngập (AI)</span>
                <span className="font-bold text-slate-700 dark:text-slate-200">{aiDay.flood_depth_cm} cm</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500 dark:text-slate-400">Rủi ro</span>
                <span className={cn('flex items-center gap-1 font-bold', riskCfg.text)}>
                  <span className={cn('h-1.5 w-1.5 rounded-full', riskCfg.dot)} />
                  {riskCfg.label}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export function WeatherPage() {
  const { t } = useTranslation()
  // Không dùng getFloodPrediction() nữa – tránh scan 53K nodes
  // LocationSearch vẫn hoạt động với Nominatim tìm kiếm địa chỉ tự do (chế độ geo-only)
  const [districtInput, setDistrictInput] = useState('')
  const [districtFilter, setDistrictFilter] = useState('')
  const [mapFlyTo, setMapFlyTo] = useState<LatLngExpression | null>(null)
  const forecastScrollRef = useRef<HTMLDivElement>(null)

  // Lấy thời tiết Khu vực Trung tâm Hà Nội làm mặc định
  const weather = useAsync(() => getWeather({ district: districtFilter || undefined }), [districtFilter])
  const forecast7d = useAsync(getForecast7d, [])

  const center: LatLngExpression = [21.0278, 105.8342] // Trung tâm Hà Nội

  const forecast7dData = forecast7d.data && forecast7d.data.length > 0
    ? forecast7d.data.map((d) => ({
        dateIso: d.dateIso,
        minTempC: d.minTempC,
        maxTempC: d.maxTempC,
        rainfallMm: d.rainfallMm,
        humidityPct: d.humidityPct,
      }))
    : (weather.data?.forecast7d ?? [])
  // source badge: lấy từ phần tử đầu tiên
  const forecastSource = forecast7d.data?.[0]?.source ?? null

  function scrollForecast(dir: -1 | 1) {
    forecastScrollRef.current?.scrollBy({ left: dir * 280, behavior: 'smooth' })
  }

  if (weather.loading || forecast7d.loading) return <Spinner label="Loading weather…" />
  if (weather.error) return <ErrorState error={weather.error} onRetry={weather.reload} />
  if (!weather.data) return null

  const current = weather.data.current
  const currentKind = kindFromRainfall(current.rainfallMm)
  const currentCfg = KIND_CONFIG[currentKind]
  const CurrentIcon = currentCfg.Icon

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">{t('weather.title')}</h2>
          <p className="mt-1 text-base text-slate-500 dark:text-slate-400">{t('weather.helpLine')}</p>
        </div>
        <button
          type="button"
          onClick={() => { void weather.reload(); void forecast7d.reload() }}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
        >
          <RefreshCcw className="h-3.5 w-3.5" /> Làm mới
        </button>
      </div>

      {/* Top section: 2 ô vuông bằng nhau */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:max-w-2xl">

        {/* Ô 1 — Thời tiết hiện tại */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-md dark:border-slate-700 dark:bg-slate-900">
          {/* Gradient top */}
          <div className={cn('bg-gradient-to-br px-6 py-6 text-white', currentCfg.gradient)}>
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-widest text-white/60">Thời tiết hiện tại</div>
                <div className="mt-1.5 flex items-center gap-1.5 text-sm font-semibold text-white/90">
                  <MapPin className="h-4 w-4" />
                  {current.locationName}
                </div>
              </div>
              <div className="rounded-2xl bg-white/20 p-3 backdrop-blur">
                <CurrentIcon className="h-9 w-9 text-white" />
              </div>
            </div>
            <div className="mt-5">
              <div className="text-7xl font-black leading-none tracking-tight">
                {current.temperatureC}°
              </div>
              <div className="mt-2 text-base font-semibold text-white/80">{currentCfg.label}</div>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 divide-x divide-slate-100 dark:divide-slate-800">
            <div className="flex flex-col items-center gap-1.5 py-5">
              <Droplets className="h-5 w-5 text-sky-500" />
              <div className="text-lg font-extrabold text-sky-600 dark:text-sky-400">{current.humidityPct}%</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Độ ẩm</div>
            </div>
            <div className="flex flex-col items-center gap-1.5 py-5">
              <Wind className="h-5 w-5 text-cyan-500" />
              <div className="text-lg font-extrabold text-cyan-600 dark:text-cyan-400">{current.windKph}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">km/h</div>
            </div>
            <div className="flex flex-col items-center gap-1.5 py-5">
              <CloudRain className="h-5 w-5 text-indigo-500" />
              <div className="text-lg font-extrabold text-indigo-600 dark:text-indigo-400">{current.rainfallMm}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">mm mưa</div>
            </div>
          </div>

          <div className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
            Cập nhật {new Date(current.observedAtIso).toLocaleString('vi-VN')}
          </div>
        </div>

        {/* Ô 2 — Bản đồ */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <LocationSearch
                id="weather-location-search"
                districts={[]}  // Nominatim geo-search mode: không cần list quận nội bộ
                label={t('weather.searchDistrict')}
                placeholder={t('floodMap.searchDistrict')}
                value={districtInput}
                onChange={setDistrictInput}
                onFilterChange={setDistrictFilter}
                onSelectGeoResult={(r) => setMapFlyTo([parseFloat(r.lat), parseFloat(r.lon)])}
              />
            </div>
          </div>
          {/* Map chiếm phần còn lại của ô vuông — override aspect-square bằng h-full */}
          <div className="min-h-0 flex-1">
            <MiniFloodMap
              districts={[]}
              selectedDistrictId={undefined}
              center={center}
              zoom={12}
              flyTo={mapFlyTo}
              className="!aspect-auto h-full w-full"
            />
          </div>
        </div>
      </div>

      {/* 7-day forecast */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        {/* Section header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div>
            <div className="text-sm font-extrabold text-slate-900 dark:text-slate-100">Dự báo 7 ngày</div>
            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {formatDateFull(forecast7dData[0]?.dateIso ?? new Date().toISOString())} →{' '}
              {formatDateFull(forecast7dData[forecast7dData.length - 1]?.dateIso ?? new Date().toISOString())}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {forecast7d.data && forecast7d.data.length > 0 && (
              <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-bold text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                ✦ AI CatBoost
              </span>
            )}
            {forecastSource === 'database' && (
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                📦 Cronjob Cache
              </span>
            )}
            {(forecastSource === 'live-owm' || forecastSource === 'live-owm-ai') && (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                🌐 Live OWM
              </span>
            )}
            <button
              type="button"
              onClick={() => scrollForecast(-1)}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => scrollForecast(1)}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Cards scroll */}
        <div
          ref={forecastScrollRef}
          className="flex gap-4 overflow-x-auto scroll-smooth p-5 scrollbar-hide"
        >
          {forecast7dData.map((d, i) => (
            <div key={d.dateIso} className="w-48 min-w-[180px] shrink-0">
              <WeatherForecastCard d={d} aiDay={forecast7d.data?.[i] ?? null} isFirst={i === 0} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
