import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, CloudRain, Droplets, MapPin, RefreshCcw, Sun, Wind, Thermometer, Eye, Activity, TrendingUp } from 'lucide-react'
import type { LatLngExpression } from 'leaflet'
import { useTranslation } from 'react-i18next'
import { Spinner } from '../components/Spinner'
import { ErrorState } from '../components/ErrorState'
import { MiniFloodMap } from '../components/MiniFloodMap'
import { LocationSearch } from '../components/LocationSearch'
import { useAsync } from '../hooks/useAsync'
import { getFloodPrediction, getWeather, getForecast7dAI } from '../services/api'
import type { FloodDistrict, WeatherForecastDay } from '../utils/types'
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


const RISK_LABEL: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  safe:   { label: 'An toàn',    bg: 'bg-emerald-50 dark:bg-emerald-950/30',  text: 'text-emerald-700 dark:text-emerald-400', dot: 'bg-emerald-500' },
  medium: { label: 'Trung bình', bg: 'bg-amber-50 dark:bg-amber-950/30',      text: 'text-amber-700 dark:text-amber-400',     dot: 'bg-amber-500'   },
  high:   { label: 'Cao',        bg: 'bg-orange-50 dark:bg-orange-950/30',    text: 'text-orange-700 dark:text-orange-400',   dot: 'bg-orange-500'  },
  severe: { label: 'Nguy hiểm',  bg: 'bg-rose-50 dark:bg-rose-950/30',        text: 'text-rose-700 dark:text-rose-400',       dot: 'bg-rose-500'    },
}

// ── Bảng danh sách quận + risk level (compact, khớp chiều cao map) ──
function DistrictRiskTable({ districts, heightRef }: { districts: FloodDistrict[]; heightRef?: string }) {
  const [filter, setFilter] = useState('')
  const filtered = useMemo(() => {
    const q = filter.toLowerCase()
    return q ? districts.filter((d) => d.name.toLowerCase().includes(q)) : districts
  }, [districts, filter])

  const riskOrder = { severe: 0, high: 1, medium: 2, safe: 3 }
  const sorted = useMemo(
    () => [...filtered].sort((a, b) => (riskOrder[a.risk] ?? 4) - (riskOrder[b.risk] ?? 4)),
    [filtered],
  )

  return (
    <div className={cn('flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900', heightRef)}>
      {/* Header compact */}
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5 dark:border-slate-800">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-extrabold text-slate-800 dark:text-slate-100">Dự báo ngập theo quận</div>
          <div className="text-[10px] text-slate-400">{districts.length} quận/huyện</div>
        </div>
        <input
          type="text"
          placeholder="Lọc..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-24 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700 outline-none focus:border-sky-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        />
      </div>
      {/* Table scroll chiếm toàn bộ chiều cao còn lại */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full">
          <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800">
            <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-slate-400">
              <th className="px-3 py-2">Quận / huyện</th>
              <th className="px-2 py-2">Rủi ro</th>
              <th className="px-2 py-2 text-right">Ngập</th>
              <th className="px-3 py-2 text-right">Mưa</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {sorted.map((d) => {
              const r = RISK_LABEL[d.risk] ?? RISK_LABEL.safe
              return (
                <tr key={d.id} className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-3 py-1.5 text-[11px] font-semibold text-slate-800 dark:text-slate-100">{d.name}</td>
                  <td className="px-2 py-1.5">
                    <span className={cn('flex w-fit items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold', r.text)}>
                      <span className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0', r.dot)} />
                      {r.label}
                    </span>
                  </td>
                  <td className={cn('px-2 py-1.5 text-right text-[11px] font-bold tabular-nums', r.text)}>
                    {d.flood_depth_cm > 0 ? `${d.flood_depth_cm}cm` : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right text-[11px] font-semibold tabular-nums text-slate-500 dark:text-slate-400">
                    {d.predictedRainfallMm}mm
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Mini bar chart mưa 24h ───────────────────────────────────────────
function Rain24hChart({ forecast24h }: { forecast24h: { timeIso: string; rainfallMm: number }[] }) {
  if (!forecast24h.length) return null
  const maxVal = Math.max(...forecast24h.map((p) => p.rainfallMm), 1)

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-sky-500" />
          <div className="text-sm font-extrabold text-slate-900 dark:text-slate-100">Lượng mưa 24 giờ tới</div>
        </div>
        <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Dự báo theo từng giờ (mm)</div>
      </div>
      <div className="flex items-end gap-1 px-5 py-4" style={{ height: 120 }}>
        {forecast24h.map((p) => {
          const pct = (p.rainfallMm / maxVal) * 100
          const hour = new Date(p.timeIso).getHours()
          const isNow = hour === new Date().getHours()
          return (
            <div key={p.timeIso} className="group relative flex flex-1 flex-col items-center justify-end" style={{ height: '100%' }}>
              <div
                className={cn(
                  'w-full rounded-t-sm transition-all',
                  pct > 60 ? 'bg-rose-400' : pct > 30 ? 'bg-amber-400' : 'bg-sky-400',
                  isNow && 'ring-2 ring-sky-600',
                )}
                style={{ height: `${Math.max(pct, 4)}%` }}
              />
              <div className="mt-1 text-[9px] text-slate-400 dark:text-slate-500">{hour}h</div>
              {/* Tooltip */}
              <div className="pointer-events-none absolute bottom-full mb-1 hidden rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-white group-hover:block">
                {p.rainfallMm}mm
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function WeatherPage() {
  const { t } = useTranslation()
  const flood = useAsync(getFloodPrediction, [])
  const [districtInput, setDistrictInput] = useState('')
  const [districtFilter, setDistrictFilter] = useState('')
  const [mapFlyTo, setMapFlyTo] = useState<LatLngExpression | null>(null)
  const forecastScrollRef = useRef<HTMLDivElement>(null)

  const selectedDistrict = useMemo<FloodDistrict | undefined>(() => {
    const list = flood.data?.districts ?? []
    const q = districtFilter.trim().toLowerCase()
    if (!list.length) return undefined
    if (!q) return list[0]
    return list.find((d) => d.name.toLowerCase().includes(q)) ?? list[0]
  }, [flood.data, districtFilter])

  const weather = useAsync(() => getWeather({ district: selectedDistrict?.name }), [selectedDistrict?.name])
  const forecast7dAI = useAsync(getForecast7dAI, [])

  const center = useMemo<LatLngExpression>(() => {
    const first = flood.data?.districts?.[0]
    if (!first) return [21.0278, 105.8342]
    return centroid(first.polygon)
  }, [flood.data])

  const forecast7d = forecast7dAI.data && forecast7dAI.data.length > 0
    ? forecast7dAI.data.map((d) => ({
        dateIso: d.dateIso,
        minTempC: d.minTempC,
        maxTempC: d.maxTempC,
        rainfallMm: d.rainfallMm,
        humidityPct: d.humidityPct,
      }))
    : (weather.data?.forecast7d ?? [])

  function scrollForecast(dir: -1 | 1) {
    forecastScrollRef.current?.scrollBy({ left: dir * 280, behavior: 'smooth' })
  }

  if (flood.loading || weather.loading || forecast7dAI.loading) return <Spinner label="Loading weather…" />
  if (flood.error) return <ErrorState error={flood.error} onRetry={flood.reload} />
  if (weather.error) return <ErrorState error={weather.error} onRetry={weather.reload} />
  if (!flood.data || !weather.data) return null

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
          onClick={() => { void weather.reload(); void forecast7dAI.reload() }}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
        >
          <RefreshCcw className="h-3.5 w-3.5" /> Làm mới
        </button>
      </div>

      {/* ── Hàng 1: Thời tiết hiện tại + Bản đồ + Bảng quận ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">

        {/* Cột trái: thời tiết hiện tại (4/12) */}
        <div className="lg:col-span-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-md dark:border-slate-700 dark:bg-slate-900">
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
              <div className="text-7xl font-black leading-none tracking-tight">{current.temperatureC}°</div>
              <div className="mt-2 text-base font-semibold text-white/80">{currentCfg.label}</div>
            </div>
          </div>
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
          {/* Quick stats bên dưới trong cùng card */}
          <div className="grid grid-cols-2 gap-3 border-t border-slate-100 p-4 dark:border-slate-800">
            <div className="rounded-xl bg-orange-50 p-3 dark:bg-orange-900/20">
              <div className="flex items-center gap-2">
                <Thermometer className="h-4 w-4 text-orange-500" />
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Cảm giác</span>
              </div>
              <div className="mt-1 text-lg font-extrabold text-orange-600 dark:text-orange-400">
                {Math.round(current.temperatureC + (current.humidityPct > 70 ? 2 : 0))}°C
              </div>
            </div>
            <div className="rounded-xl bg-indigo-50 p-3 dark:bg-indigo-900/20">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-indigo-500" />
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Mưa</span>
              </div>
              <div className="mt-1 text-lg font-extrabold text-indigo-600 dark:text-indigo-400">
                {current.rainfallMm >= 60 ? 'Rất lớn' : current.rainfallMm >= 25 ? 'Lớn' : 'Nhỏ'}
              </div>
            </div>
          </div>
          <div className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
            Cập nhật {new Date(current.observedAtIso).toLocaleString('vi-VN')}
          </div>
        </div>

        {/* Cột giữa: bản đồ mini (4/12) */}
        <div className="lg:col-span-4 flex flex-col gap-2" style={{ height: 460 }}>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="min-w-0 flex-1">
              <LocationSearch
                id="weather-location-search"
                districts={flood.data.districts}
                label={t('weather.searchDistrict')}
                placeholder={t('floodMap.searchDistrict')}
                value={districtInput}
                onChange={setDistrictInput}
                onFilterChange={setDistrictFilter}
                onSelectDistrict={(d) => setMapFlyTo(centroid(d.polygon))}
              />
            </div>
            {selectedDistrict && (
              <div className="flex shrink-0 flex-col items-end">
                <span className="text-[11px] font-semibold text-slate-400">Đang chọn</span>
                <span className="max-w-[8rem] truncate text-sm font-extrabold text-slate-800 dark:text-slate-100">
                  {selectedDistrict.name}
                </span>
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1">
            <MiniFloodMap
              districts={flood.data.districts}
              selectedDistrictId={selectedDistrict?.id}
              center={center}
              zoom={12}
              flyTo={mapFlyTo}
              className="!aspect-auto h-full w-full"
            />
          </div>
        </div>

        {/* Cột phải: bảng quận compact — cùng chiều cao với cột bản đồ */}
        <div className="lg:col-span-4" style={{ height: 460 }}>
          <DistrictRiskTable districts={flood.data.districts} heightRef="h-full" />
        </div>
      </div>

      {/* ── Hàng 2: biểu đồ mưa 24h + thanh tổng quan rủi ro ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Rain24hChart forecast24h={weather.data.forecast24h} />

        {/* Flood risk overview */}
        {(() => {
          const counts = { safe: 0, medium: 0, high: 0, severe: 0 }
          flood.data.districts.forEach((d) => { counts[d.risk] = (counts[d.risk] ?? 0) + 1 })
          const total = flood.data.districts.length || 1
          return (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <div className="mb-3 flex items-center gap-2">
                <Eye className="h-4 w-4 text-slate-500" />
                <span className="text-sm font-extrabold text-slate-900 dark:text-slate-100">Tổng quan rủi ro — {total} quận/huyện</span>
              </div>
              <div className="flex h-5 w-full overflow-hidden rounded-full">
                {counts.severe > 0 && <div className="bg-rose-500" style={{ width: `${(counts.severe / total) * 100}%` }} title={`Nguy hiểm: ${counts.severe}`} />}
                {counts.high > 0 && <div className="bg-orange-400" style={{ width: `${(counts.high / total) * 100}%` }} title={`Cao: ${counts.high}`} />}
                {counts.medium > 0 && <div className="bg-amber-400" style={{ width: `${(counts.medium / total) * 100}%` }} title={`Trung bình: ${counts.medium}`} />}
                {counts.safe > 0 && <div className="bg-emerald-400" style={{ width: `${(counts.safe / total) * 100}%` }} title={`An toàn: ${counts.safe}`} />}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {[
                  { key: 'severe', label: 'Nguy hiểm', color: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-400', count: counts.severe },
                  { key: 'high',   label: 'Cao',        color: 'bg-orange-400', text: 'text-orange-600 dark:text-orange-400', count: counts.high },
                  { key: 'medium', label: 'Trung bình', color: 'bg-amber-400', text: 'text-amber-600 dark:text-amber-400', count: counts.medium },
                  { key: 'safe',   label: 'An toàn',    color: 'bg-emerald-400', text: 'text-emerald-600 dark:text-emerald-400', count: counts.safe },
                ].map((item) => (
                  <div key={item.key} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
                    <span className={cn('flex items-center gap-2 text-xs font-semibold', item.text)}>
                      <span className={cn('h-2.5 w-2.5 rounded-full', item.color)} />
                      {item.label}
                    </span>
                    <span className={cn('text-lg font-extrabold', item.text)}>{item.count}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 text-xs text-slate-400 dark:text-slate-500">
                Tỉ lệ: {Math.round((counts.safe / total) * 100)}% an toàn · {Math.round(((counts.high + counts.severe) / total) * 100)}% nguy cơ cao
              </div>
            </div>
          )
        })()}
      </div>

      {/* 7-day forecast */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        {/* Section header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div>
            <div className="text-sm font-extrabold text-slate-900 dark:text-slate-100">{t('weather.sevenDayForecast')}</div>
            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {formatDateFull(forecast7d[0]?.dateIso ?? new Date().toISOString())} →{' '}
              {formatDateFull(forecast7d[forecast7d.length - 1]?.dateIso ?? new Date().toISOString())}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {forecast7dAI.data && forecast7dAI.data.length > 0 && (
              <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-bold text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                ✦ AI CatBoost
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
          {forecast7d.map((d, i) => (
            <div key={d.dateIso} className="w-48 min-w-[180px] shrink-0">
              <WeatherForecastCard d={d} aiDay={forecast7dAI.data?.[i] ?? null} isFirst={i === 0} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
