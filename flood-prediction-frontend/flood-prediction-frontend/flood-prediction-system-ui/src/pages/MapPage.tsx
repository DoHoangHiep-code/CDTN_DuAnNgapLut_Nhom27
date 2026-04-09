import { useEffect, useMemo, useState } from 'react'
import { MapContainer, Marker, TileLayer, Tooltip, useMap } from 'react-leaflet'
import type { LatLngExpression } from 'leaflet'
import * as L from 'leaflet'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Card, CardHeader, CardMeta, CardTitle } from '../components/Card'
import { Spinner } from '../components/Spinner'
import { ErrorState } from '../components/ErrorState'
import { RiskBadge } from '../components/Badge'
import { useAsync } from '../hooks/useAsync'
import { useDebounce } from '../hooks/useDebounce'
import { getFloodPrediction, getWeather } from '../services/api'
import type { RiskLevel } from '../utils/types'
import { depthCmFromRainfall, formatDepthCm } from '../utils/floodDepth'
import { cn } from '../utils/cn'
import { CloudRain, Sun, AlertTriangle } from 'lucide-react'

const RISK_FILL: Record<RiskLevel, { color: string; fillColor: string }> = {
  safe: { color: '#16a34a', fillColor: 'rgba(22,163,74,0.25)' }, // green
  medium: { color: '#f59e0b', fillColor: 'rgba(245,158,11,0.25)' }, // yellow
  high: { color: '#f97316', fillColor: 'rgba(249,115,22,0.25)' }, // orange
  severe: { color: '#e11d48', fillColor: 'rgba(225,29,72,0.25)' }, // red
}

function centroid(poly: [number, number][]): LatLngExpression {
  const avg = poly.reduce(
    (acc, p) => ({ lat: acc.lat + p[0], lng: acc.lng + p[1] }),
    { lat: 0, lng: 0 },
  )
  return [avg.lat / poly.length, avg.lng / poly.length]
}

function polygonAreaScore(poly: [number, number][]): number {
  let minLat = Number.POSITIVE_INFINITY
  let maxLat = Number.NEGATIVE_INFINITY
  let minLng = Number.POSITIVE_INFINITY
  let maxLng = Number.NEGATIVE_INFINITY
  for (const [lat, lng] of poly) {
    minLat = Math.min(minLat, lat)
    maxLat = Math.max(maxLat, lat)
    minLng = Math.min(minLng, lng)
    maxLng = Math.max(maxLng, lng)
  }
  // approximate area on degrees^2 (demo)
  return Math.max(0, (maxLat - minLat) * (maxLng - minLng))
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

export function MapPage() {
  const { t } = useTranslation()
  const flood = useAsync(getFloodPrediction, [])
  const weather = useAsync(getWeather, [])
  const [searchInput, setSearchInput] = useState('')
  const search = useDebounce(searchInput, 300)
  const [map, setMap] = useState<L.Map | null>(null)
  const [searchParams] = useSearchParams()
  const districtIdFromUrl = searchParams.get('districtId')

  const defaultCenter: LatLngExpression = [21.0278, 105.8342]
  const defaultZoom = 12

  const center = useMemo<LatLngExpression>(() => {
    const first = flood.data?.districts?.[0]
    if (!first) return [21.0278, 105.8342]
    return centroid(first.polygon)
  }, [flood.data])

  const districtFromUrl = useMemo(() => {
    if (!districtIdFromUrl) return undefined
    return flood.data?.districts?.find((d) => d.id === districtIdFromUrl)
  }, [flood.data, districtIdFromUrl])

  const areaStats = useMemo(() => {
    const districts = flood.data?.districts ?? []
    const areas = districts.map((d) => polygonAreaScore(d.polygon))
    const maxArea = Math.max(...areas, 1e-9)
    const byId = new Map<string, number>()
    for (let i = 0; i < districts.length; i++) byId.set(districts[i]!.id, areas[i]!)
    return { maxArea, byId }
  }, [flood.data])

  const filteredDistricts = useMemo(() => {
    const list = flood.data?.districts ?? []
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter((d) => d.name.toLowerCase().includes(q))
  }, [flood.data, search])

  const avgRain = useMemo(() => {
    const list = flood.data?.districts ?? []
    if (!list.length) return 0
    const sum = list.reduce((acc, d) => acc + d.predictedRainfallMm, 0)
    return sum / list.length
  }, [flood.data])

  useEffect(() => {
    if (!map || !districtFromUrl) return
    const pos = centroid(districtFromUrl.polygon)
    map.flyTo(pos, 15, { animate: true, duration: 0.6 })
  }, [map, districtFromUrl])
  if (flood.loading || weather.loading) return <Spinner label="Loading map…" />
  if (flood.error) return <ErrorState error={flood.error} onRetry={flood.reload} />
  if (weather.error) return <ErrorState error={weather.error} onRetry={weather.reload} />
  if (!flood.data || !weather.data) return null

  const currentTempC = Math.round(weather.data.current.temperatureC)
  const globalRain = avgRain

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
          {t('floodMap.title')}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('floodMap.hint')}</p>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 lg:col-span-8">
          <div className="relative">
            <div className="absolute left-3 top-3 z-[10] flex w-full max-w-md items-center gap-2 rounded-2xl bg-white/70 px-3 py-2 shadow-sm backdrop-blur dark:bg-slate-950/50">
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                  placeholder={t('floodMap.searchDistrict')}
                className={cn(
                  'w-full bg-transparent text-sm outline-none',
                  'placeholder:text-slate-500 dark:placeholder:text-slate-400',
                )}
              />
            </div>

            <button
              type="button"
              onClick={() => map?.flyTo(defaultCenter, defaultZoom)}
              className="absolute right-3 top-3 z-[10] rounded-2xl border border-slate-200 bg-white/70 px-3 py-2 text-xs font-bold text-slate-800 shadow-sm backdrop-blur hover:bg-white dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-100"
            >
              {t('floodMap.resetView')}
            </button>

            <MapContainer
              center={center}
              zoom={12}
              scrollWheelZoom
              className="h-[32rem] w-full"
            >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
              <MapBridge onMap={setMap} />

              {filteredDistricts.map((d) => {
                const pos = centroid(d.polygon)
                const depthCm = depthCmFromRainfall(d.predictedRainfallMm, d.risk)
                const area = areaStats.byId.get(d.id) ?? 0
                const areaNorm = clamp(area / areaStats.maxArea, 0, 1)

                const bubbleSize = clamp(10 + depthCm * 0.32 + areaNorm * 8, 10, 42)
                const pulseSpread = clamp(8 + depthCm * 0.08 + areaNorm * 4, 8, 18)
                const districtTemp = Math.round(currentTempC + (d.predictedRainfallMm - globalRain) / 12)

                const iconHtml = `<div class="fps-map-marker fps-map-marker--${d.risk} fps-map-bubble-hit" style="--bubble-size:${bubbleSize}px;--pulse-spread:${pulseSpread}px;"></div>`
                const icon = L.divIcon({
                  html: iconHtml,
                  className: '',
                  iconSize: [bubbleSize, bubbleSize],
                  iconAnchor: [bubbleSize / 2, bubbleSize / 2],
                })

                return (
                  <Marker
                    key={d.id}
                    position={pos}
                    icon={icon}
                    eventHandlers={{
                      click: () => {
                        map?.flyTo(pos, 15, { animate: true, duration: 0.6 })
                      },
                    }}
                  >
                    <Tooltip direction="top" className="fps-map-tooltip" opacity={1}>
                      <div className="space-y-1">
                        <div className="text-sm font-extrabold">{d.name}</div>
                        <div className="flex items-center gap-2">
                          <WeatherIconSmall risk={d.risk} />
                          <div className="text-xs text-slate-700 dark:text-slate-200">{t(weatherKindFromRiskKey(d.risk))}</div>
                        </div>
                        <div className="text-xs text-slate-700 dark:text-slate-200">
                          {t('floodMap.temperature')}: {districtTemp}°C
                        </div>
                        <div className="text-xs text-slate-700 dark:text-slate-200">
                          {t('floodMap.rainfall')}: {d.predictedRainfallMm} mm
                        </div>
                        <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {t('floodMap.floodDepth')}: {formatDepthCm(depthCm)}
                        </div>
                      </div>
                    </Tooltip>
                  </Marker>
                )
              })}
            </MapContainer>
          </div>
        </div>

        <Card className="h-fit col-span-12 lg:col-span-4">
          <CardHeader>
            <div>
              <CardTitle>{t('floodMap.legend')}</CardTitle>
              <CardMeta>{t('floodMap.riskZones')}</CardMeta>
            </div>
          </CardHeader>
          <div className="space-y-2 text-sm">
            <LegendRow label={t('floodMap.safe')} level="safe" />
            <LegendRow label={t('floodMap.mediumRisk')} level="medium" />
            <LegendRow label={t('floodMap.highRisk')} level="high" />
            <LegendRow label={t('floodMap.severeRisk')} level="severe" />
          </div>

          <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-950/40 dark:text-slate-300">
            Data source: `GET /api/flood-prediction` (mocked in dev)
          </div>
        </Card>
      </div>
    </div>
  )
}

function MapBridge({ onMap }: { onMap: (m: L.Map) => void }) {
  const m = useMap()
  useEffect(() => {
    onMap(m)
  }, [m, onMap])
  return null
}

function LegendRow({ label, level }: { label: string; level: RiskLevel }) {
  const s = RISK_FILL[level]
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span
          className="h-3.5 w-3.5 rounded"
          style={{ backgroundColor: s.fillColor, outline: `2px solid ${s.color}` }}
        />
        <span className="font-semibold text-slate-800 dark:text-slate-100">{label}</span>
      </div>
      <RiskBadge level={level} />
    </div>
  )
}

function weatherKindFromRiskKey(risk: RiskLevel): 'weather.kindRain' | 'weather.kindSun' | 'weather.kindFlood' {
  if (risk === 'severe') return 'weather.kindFlood'
  if (risk === 'safe') return 'weather.kindSun'
  return 'weather.kindRain'
}

function WeatherIconSmall({ risk }: { risk: RiskLevel }) {
  const kindKey = weatherKindFromRiskKey(risk)
  const Icon = kindKey === 'weather.kindRain' ? CloudRain : kindKey === 'weather.kindSun' ? Sun : AlertTriangle
  return <Icon className="h-4 w-4 fps-3d-icon text-slate-700 dark:text-slate-200" />
}

