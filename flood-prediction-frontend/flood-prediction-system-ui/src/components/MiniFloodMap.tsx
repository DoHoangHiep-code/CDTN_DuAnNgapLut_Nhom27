import { useEffect, useMemo, useState } from 'react'
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet'
import type { LatLngExpression } from 'leaflet'
import type { FloodDistrict, RiskLevel } from '../utils/types'
import { cn } from '../utils/cn'
import { depthCmFromRainfall, formatDepthCm } from '../utils/floodDepth'
import { AlertTriangle, CloudRain, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

const RISK_COLOR: Record<RiskLevel, string> = {
  safe: '#22c55e',
  medium: '#f59e0b',
  high: '#f97316',
  severe: '#e11d48',
}

function centroid(poly: [number, number][]): LatLngExpression {
  const avg = poly.reduce(
    (acc, p) => ({ lat: acc.lat + p[0], lng: acc.lng + p[1] }),
    { lat: 0, lng: 0 },
  )
  return [avg.lat / poly.length, avg.lng / poly.length]
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

function FlyToPosition({ position }: { position: LatLngExpression | null | undefined }) {
  const map = useMap()
  const lat =
    position == null ? undefined : Array.isArray(position) ? position[0] : (position as { lat: number }).lat
  const lng =
    position == null ? undefined : Array.isArray(position) ? position[1] : (position as { lng: number }).lng

  useEffect(() => {
    if (lat == null || lng == null) return
    map.flyTo([lat, lng], 14, { duration: 1.5 })
  }, [lat, lng, map])
  return null
}

export function MiniFloodMap({
  districts,
  selectedDistrictId,
  center,
  zoom = 12,
  className,
  flyTo,
}: {
  districts: FloodDistrict[]
  selectedDistrictId?: string
  center: LatLngExpression
  zoom?: number
  className?: string
  /** Khi đổi (tìm địa điểm), bản đồ bay tới tọa độ */
  flyTo?: LatLngExpression | null
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [playing, setPlaying] = useState(false)
  const [phase, setPhase] = useState(0)

  const cycleMs = 2200
  useEffect(() => {
    if (!playing) return
    setPhase(0)
    const start = Date.now()
    const id = window.setInterval(() => {
      const t = (Date.now() - start) / cycleMs
      const next = Math.min(1, t)
      setPhase(next)
      if (next >= 1) {
        setPlaying(false)
      }
    }, 50)
    return () => window.clearInterval(id)
  }, [playing])

  const positions = useMemo(() => {
    const visible = selectedDistrictId ? districts.filter((d) => d.id === selectedDistrictId) : districts
    return visible.map((d) => ({ id: d.id, name: d.name, risk: d.risk, pos: centroid(d.polygon), mm: d.predictedRainfallMm }))
  }, [districts, selectedDistrictId])

  return (
    <div className={cn("relative aspect-square w-full overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800", className)}>
      <div className="absolute left-2 top-2 z-[5] flex items-center gap-2 rounded-xl bg-white/60 px-2 py-1 backdrop-blur dark:bg-slate-950/50">
        <span className="text-[11px] font-extrabold text-slate-800 dark:text-slate-100">{t('miniMap.radarTimelapse')}</span>
        <button
          type="button"
          onClick={() => setPlaying((v) => !v)}
          className={cn(
            'rounded-lg border px-2 py-1 text-[11px] font-bold transition',
            playing
              ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/20 dark:text-red-200'
              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900/20 dark:text-slate-100 dark:hover:bg-slate-900/35',
          )}
        >
          {playing ? t('miniMap.playing') : t('miniMap.play')}
        </button>
      </div>

      <MapContainer center={center} zoom={zoom} scrollWheelZoom={false} className="h-full w-full">
        <FlyToPosition position={flyTo ?? null} />
        <TileLayer
          attribution=""
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {positions.map((p) => {
          const depthCm = depthCmFromRainfall(p.mm, p.risk)
          const baseRadius = 5 + depthCm * 0.18 // pixels
          const radarRadius = baseRadius * (0.55 + phase * 1.35)

          const isSelected = selectedDistrictId ? p.id === selectedDistrictId : true
          const dim = selectedDistrictId ? (isSelected ? 1 : 0.25) : 1

          const color = RISK_COLOR[p.risk]
          const fillOpacity = (0.15 + phase * 0.35) * dim
          const strokeOpacity = (0.35 + phase * 0.55) * dim

          return (
            <CircleMarker
              key={p.id}
              center={p.pos}
              radius={radarRadius}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity,
                weight: isSelected ? 2 : 1,
                opacity: strokeOpacity,
              }}
              eventHandlers={{
                click: () => {
                  navigate(`/flood-map?districtId=${encodeURIComponent(p.id)}`)
                },
              }}
            >
              <Tooltip direction="top" className="fps-map-tooltip" opacity={1}>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-extrabold">{p.name}</div>
                    <WeatherIconSmall risk={p.risk} />
                  </div>
                  <div className="text-xs text-slate-700 dark:text-slate-200">
                    {t(weatherKindFromRiskKey(p.risk))} | {t('floodMap.rainfall')}: {p.mm} mm
                  </div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {t('floodMap.floodDepth')}: {formatDepthCm(depthCm)}
                  </div>
                </div>
              </Tooltip>
            </CircleMarker>
          )
        })}
      </MapContainer>
    </div>
  )
}

