import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, ChevronLeft, ChevronRight, CloudRain, Droplets,
  MapPin, RefreshCcw, Sun, Wind, Thermometer, Eye, Activity,
  TrendingUp, Gauge, Cloud, Zap,
} from 'lucide-react'
import type { LatLngExpression } from 'leaflet'
import { useTranslation } from 'react-i18next'
import { Spinner } from '../components/Spinner'
import { ErrorState } from '../components/ErrorState'
import { MiniFloodMap } from '../components/MiniFloodMap'
import { LocationSearch } from '../components/LocationSearch'
import type { NominatimResult } from '../components/LocationSearch'
import { useAsync } from '../hooks/useAsync'
import { getWeather, getForecast7d, getWeatherForecast24h } from '../services/api'
import type { WeatherForecastDay } from '../utils/types'
import { cn } from '../utils/cn'

// ── Types ────────────────────────────────────────────────────────────
type WeatherKind = 'rain' | 'sun' | 'flood'

type SelectedLocation = {
  lat: number
  lng: number
  name: string
}

// ── Helpers ──────────────────────────────────────────────────────────
function kindFromRainfall(mm: number): WeatherKind {
  if (mm >= 60) return 'flood'
  if (mm > 0) return 'rain'
  return 'sun'
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('vi-VN', { weekday: 'short', day: 'numeric', month: 'numeric' })
}

function formatDateFull(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' })
}

/** Giờ hiện tại theo múi giờ Hà Nội (UTC+7) */
function getNowHourVN(): number {
  const now = new Date()
  const vnMs = now.getTime() + (7 * 60 - now.getTimezoneOffset()) * 60 * 1000
  return new Date(vnMs).getHours()
}

/** Chuyển ISO timestamp sang giờ VN (UTC+7) */
function toVNHour(iso: string): number {
  const d = new Date(iso)
  const vnMs = d.getTime() + (7 * 60 - d.getTimezoneOffset()) * 60 * 1000
  return new Date(vnMs).getHours()
}

// ── Configs ───────────────────────────────────────────────────────────
const KIND_CONFIG: Record<WeatherKind, {
  gradient: string
  glassRing: string
  iconColor: string
  badgeColor: string
  label: string
  Icon: typeof CloudRain
}> = {
  rain: {
    gradient: 'from-sky-500 via-blue-500 to-indigo-600',
    glassRing: 'ring-sky-400/30',
    iconColor: 'text-sky-500',
    badgeColor: 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300',
    label: 'Mưa',
    Icon: CloudRain,
  },
  sun: {
    gradient: 'from-amber-400 via-orange-400 to-rose-500',
    glassRing: 'ring-amber-400/30',
    iconColor: 'text-amber-500',
    badgeColor: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
    label: 'Nắng',
    Icon: Sun,
  },
  flood: {
    gradient: 'from-rose-500 via-red-500 to-pink-600',
    glassRing: 'ring-rose-400/30',
    iconColor: 'text-rose-500',
    badgeColor: 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300',
    label: 'Nguy cơ ngập',
    Icon: AlertTriangle,
  },
}

const RISK_LABEL: Record<string, {
  label: string
  bg: string
  rowBg: string
  text: string
  dot: string
  bar: string
}> = {
  safe:   { label: 'An toàn',   bg: 'bg-emerald-50 dark:bg-emerald-950/30',  rowBg: '',                                             text: 'text-emerald-700 dark:text-emerald-400', dot: 'bg-emerald-500', bar: 'bg-emerald-400' },
  medium: { label: 'TB',        bg: 'bg-amber-50 dark:bg-amber-950/30',      rowBg: 'bg-amber-50/40 dark:bg-amber-950/10',          text: 'text-amber-700 dark:text-amber-400',     dot: 'bg-amber-500',   bar: 'bg-amber-400' },
  high:   { label: 'Cao',       bg: 'bg-orange-50 dark:bg-orange-950/30',    rowBg: 'bg-orange-50/40 dark:bg-orange-950/10',        text: 'text-orange-700 dark:text-orange-400',   dot: 'bg-orange-500',  bar: 'bg-orange-400' },
  severe: { label: 'Nguy hiểm', bg: 'bg-rose-50 dark:bg-rose-950/30',        rowBg: 'bg-rose-50/60 dark:bg-rose-950/20',            text: 'text-rose-700 dark:text-rose-400',       dot: 'bg-rose-500',    bar: 'bg-rose-500' },
}

// ── WeatherForecastCard ───────────────────────────────────────────────
function WeatherForecastCard({ d, aiDay, isFirst }: {
  d: WeatherForecastDay
  aiDay?: { flood_depth_cm: number; risk_level: string } | null
  isFirst?: boolean
}) {
  const kind = kindFromRainfall(d.rainfallMm)
  const cfg = KIND_CONFIG[kind]
  const riskCfg = aiDay ? (RISK_LABEL[aiDay.risk_level] ?? RISK_LABEL.safe) : null
  const Icon = cfg.Icon

  return (
    <div className={cn(
      'relative flex h-full w-full flex-col overflow-hidden rounded-2xl border transition-all duration-300',
      'hover:-translate-y-1.5 hover:shadow-2xl',
      isFirst
        ? 'border-sky-200/80 bg-gradient-to-b from-sky-50 to-white shadow-lg ring-1 ring-sky-200/50 dark:border-sky-800 dark:from-sky-950/30 dark:to-slate-900'
        : 'border-slate-200 bg-white shadow-sm hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900',
    )}>
      <div className={cn('h-1 w-full bg-gradient-to-r', cfg.gradient)} />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              {formatDate(d.dateIso)}
            </div>
            <span className={cn('mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold', cfg.badgeColor)}>
              <Icon className="h-3 w-3" />
              {cfg.label}
            </span>
          </div>
          <div className={cn('grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl ring-2', cfg.glassRing,
            isFirst ? 'bg-sky-100 dark:bg-sky-900/30' : 'bg-slate-100 dark:bg-slate-800')}>
            <Icon className={cn('h-5 w-5', cfg.iconColor)} />
          </div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-black text-slate-800 dark:text-slate-100 tabular-nums">
            {d.minTempC}°<span className="text-base font-medium text-slate-400">–</span>{d.maxTempC}°C
          </div>
        </div>
        <div className="space-y-1.5 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-slate-500"><CloudRain className="h-3 w-3 text-sky-500" /> Mưa</span>
            <span className="font-bold text-sky-600 dark:text-sky-400 tabular-nums">{d.rainfallMm} mm</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-slate-500"><Droplets className="h-3 w-3 text-indigo-500" /> Độ ẩm</span>
            <span className="font-bold text-indigo-600 dark:text-indigo-400 tabular-nums">{d.humidityPct}%</span>
          </div>
          {aiDay && riskCfg && (
            <>
              <div className="flex items-center justify-between border-t border-slate-200/60 pt-1.5 text-xs dark:border-slate-700/60">
                <span className="text-slate-500">Độ ngập (AI)</span>
                <span className="font-bold text-slate-700 dark:text-slate-200 tabular-nums">{aiDay.flood_depth_cm} cm</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Rủi ro</span>
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

// ── HourlyForecast ────────────────────────────────────────────────────
function HourlyForecast({ forecast24h }: {
  forecast24h: Array<{ timeIso: string; rainfallMm: number; tempC: number; humidity: number; cloudsPct: number }>
}) {
  const nowHour = getNowHourVN()
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll đến giờ hiện tại khi component mount
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const nowCard = container.querySelector('[data-now="true"]') as HTMLElement | null
    if (nowCard) {
      nowCard.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
    }
  }, [forecast24h.length])

  if (!forecast24h.length) return null

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
        <div className="grid h-8 w-8 place-items-center rounded-xl bg-violet-50 dark:bg-violet-900/30">
          <Zap className="h-4 w-4 text-violet-500" />
        </div>
        <div>
          <div className="text-sm font-extrabold text-slate-900 dark:text-slate-100">Dự báo theo khung giờ</div>
          <div className="text-xs text-slate-400">Hôm nay — highlight = thời điểm hiện tại</div>
        </div>
      </div>

      <div ref={scrollContainerRef} className="flex gap-2 overflow-x-auto px-4 py-3 scrollbar-hide">
        {forecast24h.map((p) => {
          const hour = toVNHour(p.timeIso)
          const isNow = hour === nowHour
          const rainKind = p.rainfallMm >= 10 ? 'flood' : p.rainfallMm > 0 ? 'rain' : 'sun'
          const RainIcon = rainKind === 'sun' ? Sun : rainKind === 'rain' ? CloudRain : AlertTriangle

          return (
            <div
              key={p.timeIso}
              data-now={isNow ? 'true' : undefined}
              className={cn(
                'flex min-w-[68px] flex-shrink-0 flex-col items-center gap-1.5 rounded-2xl border px-2.5 py-3 transition-all',
                isNow
                  ? 'border-sky-400 bg-gradient-to-b from-sky-500 to-indigo-600 text-white shadow-lg shadow-sky-200 dark:shadow-sky-900/40 scale-105'
                  : 'border-slate-100 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-200',
              )}
            >
              {/* Giờ */}
              <div className={cn('text-[11px] font-extrabold tabular-nums', isNow ? 'text-white' : 'text-slate-500 dark:text-slate-400')}>
                {String(hour).padStart(2, '0')}:00
              </div>

              {/* Icon thời tiết */}
              <RainIcon className={cn('h-5 w-5', isNow ? 'text-white' : rainKind === 'rain' ? 'text-sky-500' : rainKind === 'flood' ? 'text-rose-500' : 'text-amber-400')} />

              {/* Nhiệt độ */}
              <div className={cn('text-sm font-extrabold tabular-nums', isNow ? 'text-white' : 'text-slate-800 dark:text-slate-100')}>
                {p.tempC}°
              </div>

              {/* Mưa */}
              <div className={cn('text-[10px] font-semibold tabular-nums', isNow ? 'text-sky-100' : 'text-sky-600 dark:text-sky-400')}>
                {p.rainfallMm > 0 ? `${p.rainfallMm}mm` : '—'}
              </div>

              {/* Mây */}
              <div className={cn('flex items-center gap-0.5 text-[9px]', isNow ? 'text-white/70' : 'text-slate-400')}>
                <Cloud className="h-3 w-3" />
                {p.cloudsPct}%
              </div>

              {/* Live badge */}
              {isNow && (
                <div className="mt-0.5 rounded-full bg-white/25 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-white">
                  Live
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Rain24hChart ──────────────────────────────────────────────────────
function Rain24hChart({ forecast24h }: {
  forecast24h: Array<{ timeIso: string; rainfallMm: number; cloudsPct?: number }>
}) {
  if (!forecast24h.length) return null
  const nowHour = getNowHourVN()
  const maxVal = Math.max(...forecast24h.map((p) => p.rainfallMm), 1)
  const totalMm = forecast24h.reduce((s, p) => s + p.rainfallMm, 0)

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-xl bg-sky-50 dark:bg-sky-900/30">
              <Activity className="h-4 w-4 text-sky-500" />
            </div>
            <div className="text-sm font-extrabold text-slate-900 dark:text-slate-100">Lượng mưa 24 giờ tới</div>
          </div>
          <div className="mt-1 ml-10 text-xs text-slate-500 dark:text-slate-400">Dự báo theo từng giờ (mm)</div>
        </div>
        <div className="text-right">
          <div className="text-lg font-extrabold tabular-nums text-sky-600 dark:text-sky-400">
            {totalMm.toFixed(1)}<span className="text-xs font-medium text-slate-400"> mm</span>
          </div>
          <div className="text-[10px] text-slate-400">Tổng dự báo</div>
        </div>
      </div>
      <div className="relative px-5 pb-4 pt-5">
        {/* Y-axis guide lines */}
        <div className="pointer-events-none absolute inset-x-5 top-5 bottom-8 flex flex-col justify-between">
          {[100, 66, 33].map((pct) => (
            <div key={pct} className="h-px w-full border-t border-dashed border-slate-100 dark:border-slate-800" />
          ))}
        </div>
        <div className="relative flex items-end gap-0.5" style={{ height: 100 }}>
          {forecast24h.map((p) => {
            const pct = (p.rainfallMm / maxVal) * 100
            const hour = toVNHour(p.timeIso)
            const isNow = hour === nowHour
            const barColor = pct > 60 ? 'bg-gradient-to-t from-rose-500 to-rose-400' : pct > 30 ? 'bg-gradient-to-t from-amber-500 to-amber-400' : 'bg-gradient-to-t from-sky-500 to-sky-400'
            return (
              <div key={p.timeIso} className="group relative flex flex-1 flex-col items-center justify-end" style={{ height: '100%' }}>
                <div
                  className={cn('w-full rounded-t transition-all', barColor, isNow && 'ring-2 ring-offset-1 ring-sky-500')}
                  style={{ height: `${Math.max(pct, 3)}%` }}
                />
                <div className={cn('mt-1 text-[9px] tabular-nums', isNow ? 'font-black text-sky-600 dark:text-sky-400' : 'text-slate-400 dark:text-slate-500')}>
                  {hour}h
                </div>
                <div className="pointer-events-none absolute bottom-full mb-2 hidden rounded-lg bg-slate-800 px-2 py-1 text-[10px] font-bold text-white shadow-lg group-hover:block whitespace-nowrap">
                  {String(hour).padStart(2, '0')}:00 — {p.rainfallMm}mm
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {/* Legend */}
      <div className="flex items-center gap-4 border-t border-slate-100 px-5 py-2.5 dark:border-slate-800">
        {[
          { color: 'bg-sky-400', label: 'Nhỏ' },
          { color: 'bg-amber-400', label: 'Vừa' },
          { color: 'bg-rose-500', label: 'Lớn' },
        ].map((l) => (
          <span key={l.label} className="flex items-center gap-1.5 text-[10px] text-slate-500">
            <span className={cn('h-2 w-2 rounded-sm', l.color)} />
            {l.label}
          </span>
        ))}
        <span className="ml-auto flex items-center gap-1 text-[10px] text-sky-600 dark:text-sky-400">
          <span className="inline-block h-2 w-2 rounded-sm ring-1 ring-sky-500" />
          Giờ hiện tại
        </span>
      </div>
    </div>
  )
}

// ── RiskOverview ──────────────────────────────────────────────────────
function RiskOverview({ districts }: { districts: FloodDistrict[] }) {
  const counts = useMemo(() => {
    const c = { safe: 0, medium: 0, high: 0, severe: 0 }
    districts.forEach((d) => { c[d.risk as keyof typeof c] = (c[d.risk as keyof typeof c] ?? 0) + 1 })
    return c
  }, [districts])
  const total = districts.length || 1
  const safePct = Math.round((counts.safe / total) * 100)
  const dangerPct = Math.round(((counts.high + counts.severe) / total) * 100)

  const items = [
    { key: 'severe', label: 'Nguy hiểm', color: 'bg-rose-500',    text: 'text-rose-600 dark:text-rose-400',     count: counts.severe, icon: '🔴' },
    { key: 'high',   label: 'Cao',        color: 'bg-orange-400',  text: 'text-orange-600 dark:text-orange-400', count: counts.high,   icon: '🟠' },
    { key: 'medium', label: 'Trung bình', color: 'bg-amber-400',   text: 'text-amber-600 dark:text-amber-400',   count: counts.medium, icon: '🟡' },
    { key: 'safe',   label: 'An toàn',    color: 'bg-emerald-400', text: 'text-emerald-600 dark:text-emerald-400', count: counts.safe, icon: '🟢' },
  ]

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-xl bg-violet-50 dark:bg-violet-900/30">
              <Eye className="h-4 w-4 text-violet-500" />
            </div>
            <div className="text-sm font-extrabold text-slate-900 dark:text-slate-100">Tổng quan rủi ro</div>
          </div>
          <div className="mt-1 ml-10 text-xs text-slate-500 dark:text-slate-400">{total} quận/huyện</div>
        </div>
        <div className="text-right">
          <div className={cn('text-lg font-extrabold tabular-nums', dangerPct > 30 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400')}>
            {safePct}%<span className="text-xs font-medium text-slate-400"> an toàn</span>
          </div>
          <div className="text-[10px] text-slate-400">{dangerPct}% nguy cơ cao</div>
        </div>
      </div>

      <div className="px-5 pt-4 pb-2">
        <div className="flex h-4 w-full overflow-hidden rounded-full gap-0.5">
          {items.map((item) => item.count > 0 && (
            <div
              key={item.key}
              className={cn('flex items-center justify-center rounded-sm transition-all', item.color)}
              style={{ width: `${(item.count / total) * 100}%` }}
              title={`${item.label}: ${item.count}`}
            />
          ))}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2.5">
          {items.map((item) => (
            <div key={item.key} className={cn(
              'flex items-center justify-between rounded-xl border px-3 py-2.5 transition-all',
              item.count > 0
                ? 'border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40'
                : 'border-slate-100/50 bg-slate-50/50 opacity-50 dark:border-slate-800/50 dark:bg-slate-800/20',
            )}>
              <div className="flex items-center gap-2">
                <span className={cn('h-2.5 w-2.5 rounded-full flex-shrink-0', item.color)} />
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">{item.label}</span>
              </div>
              <div className="text-right">
                <div className={cn('text-xl font-extrabold tabular-nums leading-none', item.text)}>{item.count}</div>
                <div className="text-[9px] text-slate-400 tabular-nums">{Math.round((item.count / total) * 100)}%</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-slate-100 px-5 py-2.5 dark:border-slate-800">
        <Gauge className="h-3.5 w-3.5 text-slate-400" />
        <span className="text-[11px] text-slate-400 dark:text-slate-500">
          Chỉ số nguy cơ trung bình: <span className="font-bold text-slate-600 dark:text-slate-300">
            {(districts.reduce((s, d) => s + d.flood_depth_cm, 0) / total).toFixed(1)}cm
          </span>
        </span>
      </div>
    </div>
  )
}

// ── FloodDistrict stub (dùng cho props empty) ─────────────────────────
type FloodDistrict = {
  id: string
  name: string
  risk: 'safe' | 'medium' | 'high' | 'severe'
  predictedRainfallMm: number
  flood_depth_cm: number
  polygon: [number, number][]
  updatedAtIso: string
}

// ── WeatherPage ───────────────────────────────────────────────────────
export function WeatherPage() {
  const { t } = useTranslation()

  // ── Location state ──
  const [districtInput, setDistrictInput] = useState('')
  const [selectedLocation, setSelectedLocation] = useState<SelectedLocation | null>(null)
  const [mapFlyTo, setMapFlyTo] = useState<LatLngExpression | null>(null)
  const [searchMarker, setSearchMarker] = useState<LatLngExpression | null>(null)

  const forecastScrollRef = useRef<HTMLDivElement>(null)

  // ── Derive lat/lng for API calls ──
  const queryLat = selectedLocation?.lat
  const queryLng = selectedLocation?.lng

  // ── API calls – re-fetch when location changes ──
  const weatherParams = useMemo(
    () => ({ lat: queryLat, lng: queryLng }),
    [queryLat, queryLng],
  )
  const weather = useAsync(() => getWeather(weatherParams), [weatherParams])

  const forecast7dParams = useMemo(
    () => [queryLat, queryLng] as [number | undefined, number | undefined],
    [queryLat, queryLng],
  )
  const forecast7d = useAsync(
    () => getForecast7d(...forecast7dParams),
    [forecast7dParams],
  )

  const forecast24hParams = useMemo(
    () => [queryLat, queryLng] as [number | undefined, number | undefined],
    [queryLat, queryLng],
  )
  const forecast24h = useAsync(
    () => getWeatherForecast24h(...forecast24hParams),
    [forecast24hParams],
  )

  // ── Handle geo-search result ──
  const handleGeoResult = useCallback((r: NominatimResult) => {
    const lat = parseFloat(r.lat)
    const lng = parseFloat(r.lon)
    const name = r.display_name.split(',')[0] ?? r.display_name
    setSelectedLocation({ lat, lng, name })
    const pos: LatLngExpression = [lat, lng]
    setMapFlyTo(pos)
    setSearchMarker(pos)
  }, [])

  const handleClearLocation = useCallback(() => {
    setSelectedLocation(null)
    setMapFlyTo(null)
    setSearchMarker(null)
    setDistrictInput('')
  }, [])

  const center: LatLngExpression = selectedLocation
    ? [selectedLocation.lat, selectedLocation.lng]
    : [21.0278, 105.8342]

  // ── Derived forecast data ──
  const forecast7dData = forecast7d.data && forecast7d.data.length > 0
    ? forecast7d.data.map((d) => ({
        dateIso: d.dateIso,
        minTempC: d.minTempC,
        maxTempC: d.maxTempC,
        rainfallMm: d.rainfallMm,
        humidityPct: d.humidityPct,
      }))
    : (weather.data?.forecast7d ?? [])

  const forecastSource = forecast7d.data?.[0]?.source ?? null

  // Merge forecast24h: prefer dedicated endpoint, fallback to weather.forecast24h
  const chartForecast24h = useMemo(() => {
    if (forecast24h.data && forecast24h.data.length > 0) return forecast24h.data
    if (weather.data?.forecast24h && weather.data.forecast24h.length > 0) {
      return weather.data.forecast24h.map(p => ({
        timeIso:    p.timeIso,
        rainfallMm: p.rainfallMm,
        tempC:      (p as any).tempC ?? 0,
        humidity:   (p as any).humidity ?? 0,
        cloudsPct:  0,
      }))
    }
    return []
  }, [forecast24h.data, weather.data?.forecast24h])

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

  const locationLabel = selectedLocation?.name ?? current.locationName

  return (
    <div className="space-y-5">

      {/* ── Page Header ── */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className={cn('grid h-12 w-12 flex-shrink-0 place-items-center rounded-2xl bg-gradient-to-br shadow-lg', currentCfg.gradient)}>
            <CurrentIcon className="h-6 w-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">{t('weather.title')}</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('weather.helpLine')}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { void weather.reload(); void forecast7d.reload(); void forecast24h.reload() }}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm transition-all hover:bg-slate-50 hover:shadow dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          <RefreshCcw className="h-3.5 w-3.5" /> Làm mới
        </button>
      </div>

      {/* ── Hàng 1: Weather card + Bản đồ ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">

        {/* Weather card (4/12) */}
        <div className="lg:col-span-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-md dark:border-slate-700 dark:bg-slate-900">
          {/* Gradient hero */}
          <div className={cn('relative overflow-hidden bg-gradient-to-br px-6 py-6 text-white', currentCfg.gradient)}>
            <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10" />
            <div className="pointer-events-none absolute -bottom-4 -left-4 h-24 w-24 rounded-full bg-white/5" />

            <div className="relative flex items-start justify-between">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Thời tiết hiện tại</div>
                <div className="mt-1.5 flex items-center gap-1.5 text-sm font-semibold text-white/90">
                  <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="truncate max-w-[160px]">{locationLabel}</span>
                </div>
              </div>
              <div className="rounded-2xl bg-white/20 p-3 backdrop-blur-sm ring-1 ring-white/20">
                <CurrentIcon className="h-8 w-8 text-white" />
              </div>
            </div>
            <div className="relative mt-4">
              <div className="text-7xl font-black leading-none tracking-tight tabular-nums">{current.temperatureC}°</div>
              <div className="mt-1.5 text-base font-semibold text-white/80">{currentCfg.label}</div>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 divide-x divide-slate-100 dark:divide-slate-800">
            <div className="flex flex-col items-center gap-1 py-4">
              <Droplets className="h-5 w-5 text-sky-500" />
              <div className="text-base font-extrabold text-sky-600 dark:text-sky-400 tabular-nums">{current.humidityPct}%</div>
              <div className="text-[11px] text-slate-500">Độ ẩm</div>
            </div>
            <div className="flex flex-col items-center gap-1 py-4">
              <Wind className="h-5 w-5 text-cyan-500" />
              <div className="text-base font-extrabold text-cyan-600 dark:text-cyan-400 tabular-nums">{current.windKph}</div>
              <div className="text-[11px] text-slate-500">km/h</div>
            </div>
            <div className="flex flex-col items-center gap-1 py-4">
              <CloudRain className="h-5 w-5 text-indigo-500" />
              <div className="text-base font-extrabold text-indigo-600 dark:text-indigo-400 tabular-nums">{current.rainfallMm}</div>
              <div className="text-[11px] text-slate-500">mm mưa</div>
            </div>
          </div>

          {/* Extended stats: Clouds + Rain intensity + Feels like + Rain level */}
          <div className="grid grid-cols-2 gap-3 border-t border-slate-100 p-4 dark:border-slate-800">
            {/* Cảm giác như */}
            <div className="flex items-center gap-3 rounded-xl bg-gradient-to-br from-orange-50 to-amber-50 p-3 dark:from-orange-900/20 dark:to-amber-900/10">
              <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl bg-orange-100 dark:bg-orange-900/30">
                <Thermometer className="h-5 w-5 text-orange-500" />
              </div>
              <div>
                <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">Cảm giác</div>
                <div className="text-base font-extrabold text-orange-600 dark:text-orange-400 tabular-nums">
                  {Math.round(current.temperatureC + (current.humidityPct > 70 ? 2 : 0))}°C
                </div>
              </div>
            </div>
            {/* Cường độ mưa */}
            <div className="flex items-center gap-3 rounded-xl bg-gradient-to-br from-indigo-50 to-violet-50 p-3 dark:from-indigo-900/20 dark:to-violet-900/10">
              <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl bg-indigo-100 dark:bg-indigo-900/30">
                <TrendingUp className="h-5 w-5 text-indigo-500" />
              </div>
              <div>
                <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">Cường độ mưa</div>
                <div className="text-sm font-extrabold text-indigo-600 dark:text-indigo-400 tabular-nums">
                  {(current.rainIntensityMm ?? current.rainfallMm) > 0
                    ? `${current.rainIntensityMm ?? current.rainfallMm} mm/h`
                    : 'Không mưa'}
                </div>
              </div>
            </div>
            {/* Bao phủ mây */}
            <div className="flex items-center gap-3 rounded-xl bg-gradient-to-br from-slate-50 to-gray-50 p-3 dark:from-slate-800/40 dark:to-gray-800/20">
              <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl bg-slate-100 dark:bg-slate-800">
                <Cloud className="h-5 w-5 text-slate-500" />
              </div>
              <div>
                <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">Bao phủ mây</div>
                <div className="text-base font-extrabold text-slate-700 dark:text-slate-200 tabular-nums">
                  {current.cloudsPct ?? 0}%
                </div>
              </div>
            </div>
            {/* Mức mưa */}
            <div className="flex items-center gap-3 rounded-xl bg-gradient-to-br from-sky-50 to-cyan-50 p-3 dark:from-sky-900/20 dark:to-cyan-900/10">
              <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl bg-sky-100 dark:bg-sky-900/30">
                <CloudRain className="h-5 w-5 text-sky-500" />
              </div>
              <div>
                <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">Mức mưa</div>
                <div className="text-sm font-extrabold text-sky-600 dark:text-sky-400">
                  {current.rainfallMm >= 60 ? 'Rất lớn' : current.rainfallMm >= 25 ? 'Lớn' : current.rainfallMm > 0 ? 'Nhỏ' : 'Khô'}
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 px-5 py-2 text-[11px] text-slate-400 dark:border-slate-800 dark:text-slate-500">
            Cập nhật {new Date(current.observedAtIso).toLocaleString('vi-VN')}
          </div>
        </div>

        {/* Map (8/12) */}
        <div className="lg:col-span-8 flex flex-col gap-2" style={{ height: 520 }}>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="min-w-0 flex-1">
              <LocationSearch
                id="weather-location-search"
                districts={[]}
                label={t('weather.searchDistrict')}
                placeholder={t('floodMap.searchDistrict')}
                value={districtInput}
                onChange={(v) => {
                  setDistrictInput(v)
                  if (!v) handleClearLocation()
                }}
                onFilterChange={() => {}}
                onSelectGeoResult={handleGeoResult}
              />
            </div>
            {selectedLocation && (
              <button
                type="button"
                onClick={handleClearLocation}
                className="flex-shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-500 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                Xóa
              </button>
            )}
          </div>
          {selectedLocation && (
            <div className="flex-shrink-0 flex items-center gap-2 rounded-xl bg-sky-50 border border-sky-100 px-3 py-2 dark:bg-sky-950/30 dark:border-sky-900">
              <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-sky-500" />
              <span className="text-xs font-semibold text-sky-700 dark:text-sky-300 truncate">{selectedLocation.name}</span>
              <span className="ml-auto text-[10px] text-sky-500 tabular-nums">
                {selectedLocation.lat.toFixed(4)}, {selectedLocation.lng.toFixed(4)}
              </span>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-hidden rounded-2xl ring-1 ring-slate-200 shadow-sm dark:ring-slate-700">
            <MiniFloodMap
              districts={[]}
              selectedDistrictId={undefined}
              center={center}
              zoom={12}
              flyTo={mapFlyTo}
              searchMarker={searchMarker}
              className="!aspect-auto h-full w-full"
            />
          </div>
        </div>
      </div>

      {/* ── Hourly forecast (khung giờ hôm nay) ── */}
      <HourlyForecast forecast24h={chartForecast24h} />

      {/* ── Hàng 2: Biểu đồ mưa 24h + Tổng quan rủi ro ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Rain24hChart forecast24h={chartForecast24h} />
        <RiskOverview districts={[]} />
      </div>

      {/* ── 7-day forecast ── */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
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
