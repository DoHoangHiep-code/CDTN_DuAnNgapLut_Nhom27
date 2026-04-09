import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, CloudRain, Droplets, Sun, Thermometer, Wind } from 'lucide-react'
import type { LatLngExpression } from 'leaflet'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardHeader, CardMeta, CardTitle } from '../components/Card'
import { Spinner } from '../components/Spinner'
import { ErrorState } from '../components/ErrorState'
import { MiniFloodMap } from '../components/MiniFloodMap'
import { LocationSearch } from '../components/LocationSearch'
import { useAsync } from '../hooks/useAsync'
import { getFloodPrediction, getWeather } from '../services/api'
import type { FloodDistrict, WeatherForecastDay } from '../utils/types'
import { cn } from '../utils/cn'

type WeatherKind = 'rain' | 'sun' | 'flood'

function kindFromRainfall(mm: number): WeatherKind {
  if (mm >= 60) return 'flood'
  if (mm >= 25) return 'rain'
  return 'sun'
}

function centroid(poly: [number, number][]): LatLngExpression {
  const avg = poly.reduce(
    (acc, p) => ({ lat: acc.lat + p[0], lng: acc.lng + p[1] }),
    { lat: 0, lng: 0 },
  )
  return [avg.lat / poly.length, avg.lng / poly.length]
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

const KIND_STYLES: Record<
  WeatherKind,
  { bgClass: string; icon: string; bg: string; kindKey: string }
> = {
  rain: {
    bg: 'bg-blue-50 dark:bg-blue-950/20',
    icon: 'text-blue-700 dark:text-blue-300',
    bgClass: 'fps-weather-bg--rain',
    kindKey: 'weather.kindRain',
  },
  sun: {
    bg: 'bg-yellow-50 dark:bg-yellow-950/20',
    icon: 'text-yellow-700 dark:text-yellow-200',
    bgClass: 'fps-weather-bg--sun',
    kindKey: 'weather.kindSun',
  },
  flood: {
    bg: 'bg-red-50 dark:bg-red-950/20',
    icon: 'text-red-700 dark:text-red-300',
    bgClass: 'fps-weather-bg--flood',
    kindKey: 'weather.kindFlood',
  },
}

function WeatherCardBackground({ kind }: { kind: WeatherKind }) {
  const cls = KIND_STYLES[kind].bgClass
  return (
    <div className={cn('fps-weather-bg', cls)}>
      {kind === 'rain' ? (
        <svg viewBox="0 0 120 120" width="72" height="72">
          <path d="M30 30 L44 44 L30 44 L45 74 L36 74 L45 104 L28 68 L37 68 Z" fill="rgba(2,132,199,0.25)" />
          <path d="M70 22 L84 36" stroke="rgba(2,132,199,0.25)" strokeWidth="6" strokeLinecap="round" />
        </svg>
      ) : kind === 'sun' ? (
        <svg viewBox="0 0 120 120" width="72" height="72">
          <circle cx="56" cy="46" r="18" fill="rgba(245,158,11,0.18)" />
          <path
            d="M56 14v12M56 64v12M24 46h12M76 46h12M34 26l8 8M70 62l8 8M70 30l-8 8M34 70l8-8"
            stroke="rgba(245,158,11,0.22)"
            strokeWidth="6"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 120 120" width="72" height="72">
          <path
            d="M30 76c6-18 14-30 26-30 14 0 18 12 18 12s10-2 16 10c6 12-4 26-4 26H30Z"
            fill="rgba(225,29,72,0.20)"
          />
          <path d="M60 24l6 10-6 10-6-10Z" fill="rgba(225,29,72,0.22)" />
        </svg>
      )}
    </div>
  )
}

function WeatherIcon3D({ kind }: { kind: WeatherKind }) {
  const Icon = kind === 'rain' ? CloudRain : kind === 'sun' ? Sun : AlertTriangle
  return <Icon className={cn('h-8 w-8 fps-3d-icon', KIND_STYLES[kind].icon)} />
}

function Metric3D({
  icon,
  label,
  value,
  valueClassName,
}: {
  icon: ReactNode
  label: string
  value: string
  valueClassName?: string
}) {
  return (
    <div className="flex min-h-[5.5rem] flex-col justify-center rounded-xl border border-slate-200 bg-white/60 p-3 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-950/30">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
        <span className="fps-glass-icon grid h-9 w-9 place-items-center">{icon}</span>
        {label}
      </div>
      <div className={cn('mt-1 text-lg font-extrabold text-slate-900 dark:text-slate-100', valueClassName)}>{value}</div>
    </div>
  )
}

function WeatherForecastCard({ d }: { d: WeatherForecastDay }) {
  const kind = kindFromRainfall(d.rainfallMm)
  const s = KIND_STYLES[kind]
  const { t } = useTranslation()

  return (
    <div
      className={cn(
        'relative h-full w-full rounded-2xl border p-4 shadow-sm transition-transform duration-300',
        'hover:scale-105 hover:shadow-lg dark:text-slate-100',
        s.bg,
        'border-slate-200 dark:border-slate-800',
      )}
    >
      <WeatherCardBackground kind={kind} />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-extrabold text-slate-900 dark:text-slate-100">{formatDate(d.dateIso)}</div>
          <div className={cn('mt-1 text-xs font-semibold', s.icon)}>{t(s.kindKey)}</div>
        </div>
        <div className="grid h-12 w-12 place-items-center fps-glass-icon">
          <WeatherIcon3D kind={kind} />
        </div>
      </div>

      <div className="mt-3 space-y-1 text-xs">
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-600 dark:text-slate-300">{t('weather.temperature')}</span>
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            {d.minTempC}°C – {d.maxTempC}°C
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-600 dark:text-slate-300">{t('weather.rainfall')}</span>
          <span className="font-semibold text-slate-900 dark:text-slate-100">{d.rainfallMm} mm</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-600 dark:text-slate-300">{t('weather.humidity')}</span>
          <span className="font-semibold text-slate-900 dark:text-slate-100">{d.humidityPct}%</span>
        </div>
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

  const center = useMemo<LatLngExpression>(() => {
    const first = flood.data?.districts?.[0]
    if (!first) return [21.0278, 105.8342]
    return centroid(first.polygon)
  }, [flood.data])

  const forecast7d = weather.data?.forecast7d ?? []

  function scrollForecast(dir: -1 | 1) {
    const el = forecastScrollRef.current
    if (!el) return
    el.scrollBy({ left: dir * 300, behavior: 'smooth' })
  }

  if (flood.loading || weather.loading) return <Spinner label="Loading weather…" />
  if (flood.error) return <ErrorState error={flood.error} onRetry={flood.reload} />
  if (weather.error) return <ErrorState error={weather.error} onRetry={weather.reload} />
  if (!flood.data || !weather.data) return null

  const current = weather.data.current
  const currentKind = kindFromRainfall(current.rainfallMm)

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-extrabold tracking-tight text-slate-900 dark:text-slate-100">{t('weather.title')}</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('weather.helpLine')}</p>
      </div>

      <div className="flex gap-4 items-start">
        <div className="w-72 min-w-0">
          <Card className="relative flex min-h-fit w-full flex-col gap-3 overflow-hidden">
            <WeatherCardBackground kind={currentKind} />

            <CardHeader>
              <div>
                <CardTitle>{t('weather.currentWeather')}</CardTitle>
                <CardMeta>{current.locationName}</CardMeta>
              </div>
              <WeatherIcon3D kind={currentKind} />
            </CardHeader>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <Metric3D
                icon={<Thermometer className="h-5 w-5 fps-3d-icon text-orange-500" />}
                label={t('weather.temperature')}
                value={`${current.temperatureC} °C`}
                valueClassName="text-orange-600 dark:text-orange-400"
              />
              <Metric3D
                icon={<Droplets className="h-5 w-5 fps-3d-icon text-sky-600" />}
                label={t('weather.humidity')}
                value={`${current.humidityPct} %`}
                valueClassName="text-sky-600 dark:text-sky-400"
              />
              <Metric3D
                icon={<Wind className="h-5 w-5 fps-3d-icon text-cyan-600" />}
                label={t('weather.wind')}
                value={`${current.windKph} km/h`}
                valueClassName="text-cyan-700 dark:text-cyan-300"
              />
              <Metric3D
                icon={<CloudRain className="h-5 w-5 fps-3d-icon text-indigo-600" />}
                label={t('weather.rainfall')}
                value={`${current.rainfallMm} mm`}
                valueClassName="text-indigo-700 dark:text-indigo-300"
              />
            </div>

            <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              {t('weather.updated')} {new Date(current.observedAtIso).toLocaleString()}
            </div>
          </Card>
        </div>

        <div className="w-72 min-w-0 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
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
            <div className="flex shrink-0 flex-col items-end pt-5">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{t('weather.detected')}:</span>
              <span className="max-w-[7rem] truncate text-sm font-extrabold text-slate-900 dark:text-slate-100">
                {selectedDistrict?.name ?? '-'}
              </span>
            </div>
          </div>

          <MiniFloodMap
            districts={flood.data.districts}
            selectedDistrictId={selectedDistrict?.id}
            center={center}
            zoom={12}
            flyTo={mapFlyTo}
          />
        </div>
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <div>
            <CardTitle>{t('weather.sevenDayForecast')}</CardTitle>
            <CardMeta>Pastel cards, desktop.</CardMeta>
          </div>
        </CardHeader>

        <div className="relative min-w-0">
          <button
            type="button"
            onClick={() => scrollForecast(-1)}
            className="absolute -left-2 top-1/2 z-10 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-700 shadow-md backdrop-blur hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100 dark:hover:bg-slate-800 sm:flex"
            aria-label="Previous"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => scrollForecast(1)}
            className="absolute -right-2 top-1/2 z-10 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-700 shadow-md backdrop-blur hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100 dark:hover:bg-slate-800 sm:flex"
            aria-label="Next"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <div
            ref={forecastScrollRef}
            className="overflow-x-auto snap-x pb-4 scroll-pl-4 scroll-pr-4 scrollbar-hide"
          >
            <div className="flex w-max gap-4">
              {forecast7d.map((d) => (
                <div key={d.dateIso} className="min-w-[200px] w-64 shrink-0 snap-start">
                  <WeatherForecastCard d={d} />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('weather.dataSource')}</div>
      </Card>
    </div>
  )
}

