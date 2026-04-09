import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import type { LatLngExpression } from 'leaflet'
import * as L from 'leaflet'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { Card, CardHeader, CardMeta, CardTitle } from '../components/Card'
import { Spinner } from '../components/Spinner'
import { ErrorState } from '../components/ErrorState'
import { RiskBadge } from '../components/Badge'
import { useAsync } from '../hooks/useAsync'
import { getFloodPrediction, getWeather } from '../services/api'
import type { RiskLevel } from '../utils/types'
import { depthCmFromRainfall, formatDepthCm } from '../utils/floodDepth'
import Supercluster from 'supercluster'
import { LocationSearch } from '../components/LocationSearch'

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

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function heatColor(depthCm: number) {
  // 0..100+ cm mapped to yellow -> orange -> red -> deep red
  const t = clamp(depthCm / 100, 0, 1)
  if (t <= 0.33) return `rgb(${Math.round(255)},${Math.round(200 - 80 * (t / 0.33))},${Math.round(60)})`
  if (t <= 0.66) return `rgb(${Math.round(255)},${Math.round(120 - 90 * ((t - 0.33) / 0.33))},${Math.round(40)})`
  return `rgb(${Math.round(230 - 40 * ((t - 0.66) / 0.34))},${Math.round(30)},${Math.round(30)})`
}

type FloodPoint = {
  id: string
  name: string
  risk: RiskLevel
  predictedRainfallMm: number
  depthCm: number
  position: LatLngExpression
}

type ClusterProps = {
  cluster: true
  point_count: number
}

type PointFeature = GeoJSON.Feature<GeoJSON.Point, FloodPoint & { cluster?: false }>
type ClusterFeature = GeoJSON.Feature<GeoJSON.Point, ClusterProps & { cluster_id: number }>

function FloodClustersLayer({
  points,
  onSelectPoint,
  onSelectCluster,
}: {
  points: FloodPoint[]
  onSelectPoint: (p: FloodPoint) => void
  onSelectCluster: (lat: number, lng: number, nextZoom: number) => void
}) {
  const map = useMap()
  const [view, setView] = useState(() => {
    const b = map.getBounds()
    return { zoom: map.getZoom(), bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] as [number, number, number, number] }
  })

  useMapEvents({
    moveend: () => {
      const b = map.getBounds()
      setView({ zoom: map.getZoom(), bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] })
    },
    zoomend: () => {
      const b = map.getBounds()
      setView({ zoom: map.getZoom(), bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] })
    },
  })

  const indexRef = useRef<Supercluster<FloodPoint, ClusterProps> | null>(null)

  const features = useMemo(() => {
    return points.map<PointFeature>((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [Number((p.position as [number, number])[1]), Number((p.position as [number, number])[0])] },
      properties: { ...p, cluster: false },
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points])

  useEffect(() => {
    const sc = new Supercluster<FloodPoint, ClusterProps>({
      radius: 60,
      maxZoom: 18,
      minZoom: 0,
    })
    sc.load(features)
    indexRef.current = sc
  }, [features])

  const clusters = useMemo(() => {
    const idx = indexRef.current
    if (!idx) return [] as Array<PointFeature | ClusterFeature>
    return idx.getClusters(view.bbox, Math.round(view.zoom)) as Array<PointFeature | ClusterFeature>
  }, [view])

  const maxZoom = map.getMaxZoom?.() ?? 18
  const isMaxZoom = view.zoom >= maxZoom

  return (
    <>
      {clusters.map((f) => {
        const [lng, lat] = f.geometry.coordinates
        const isCluster = Boolean((f.properties as any).cluster)
        if (isCluster) {
          const p = f as ClusterFeature
          const count = p.properties.point_count
          const size = clamp(34 + Math.log2(Math.max(2, count)) * 10, 34, 64)
          const iconHtml = `<div style="width:${size}px;height:${size}px" class="fps-cluster">
            <div class="fps-cluster__inner">${count}</div>
          </div>`
          const icon = L.divIcon({
            html: iconHtml,
            className: '',
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
          })
          return (
            <Marker
              key={`c_${(p.properties as any).cluster_id}`}
              position={[lat, lng]}
              icon={icon}
              eventHandlers={{
                click: () => {
                  const idx = indexRef.current
                  if (!idx) return
                  const nextZoom = Math.min(idx.getClusterExpansionZoom((p.properties as any).cluster_id), 18)
                  onSelectCluster(lat, lng, nextZoom)
                },
              }}
            />
          )
        }

        const p = (f as PointFeature).properties
        const color = heatColor(p.depthCm)
        const radius = clamp(7 + p.depthCm * 0.22, 7, 24)
        return (
          <CircleMarker
            key={p.id}
            center={[lat, lng]}
            radius={radius}
            pathOptions={{
              color,
              fillColor: color,
              weight: 1,
              opacity: isMaxZoom ? 0.6 : 0.9,
              fillOpacity: isMaxZoom ? 0.6 : 0.35,
            }}
            eventHandlers={{
              click: () => onSelectPoint(p),
            }}
          >
            <Tooltip direction="top" className="fps-map-tooltip" opacity={1}>
              <div className="space-y-1">
                <div className="text-sm font-extrabold">{p.name}</div>
                <div className="text-xs text-slate-700 dark:text-slate-200">
                  {p.predictedRainfallMm} mm | {formatDepthCm(p.depthCm)}
                </div>
              </div>
            </Tooltip>
          </CircleMarker>
        )
      })}
    </>
  )
}

function FlyToSelectedLocation({ target }: { target: { lat: number; lng: number } | null }) {
  const map = useMap()
  useEffect(() => {
    if (!target) return
    map.flyTo([target.lat, target.lng], 14, { duration: 1.5 })
  }, [target?.lat, target?.lng, map])
  return null
}

export function MapPage() {
  const { t } = useTranslation()
  const flood = useAsync(getFloodPrediction, [])
  const weather = useAsync(getWeather, [])
  const [searchInput, setSearchInput] = useState('')
  const [filterTerm, setFilterTerm] = useState('')
  const [selectedLocation, setSelectedLocation] = useState<{ lat: number; lng: number } | null>(null)
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

  const filteredDistricts = useMemo(() => {
    const list = flood.data?.districts ?? []
    const q = filterTerm.toLowerCase()
    if (!q) return list
    return list.filter((d) => d.name.toLowerCase().includes(q))
  }, [flood.data, filterTerm])

  const floodPoints = useMemo<FloodPoint[]>(() => {
    return filteredDistricts.map((d) => {
      const position = centroid(d.polygon)
      const depthCm = depthCmFromRainfall(d.predictedRainfallMm, d.risk)
      return {
        id: d.id,
        name: d.name,
        risk: d.risk,
        predictedRainfallMm: d.predictedRainfallMm,
        depthCm,
        position,
      }
    })
  }, [filteredDistricts])

  useEffect(() => {
    if (!map || !districtFromUrl) return
    const pos = centroid(districtFromUrl.polygon)
    map.flyTo(pos, 15, { animate: true, duration: 0.6 })
  }, [map, districtFromUrl])
  if (flood.loading || weather.loading) return <Spinner label="Loading map…" />
  if (flood.error) return <ErrorState error={flood.error} onRetry={flood.reload} />
  if (weather.error) return <ErrorState error={weather.error} onRetry={weather.reload} />
  if (!flood.data || !weather.data) return null

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
            <div className="absolute top-4 left-4 z-[1000] w-full max-w-md pointer-events-auto">
              <LocationSearch
                districts={flood.data.districts}
                placeholder={t('floodMap.searchDistrict')}
                value={searchInput}
                onChange={setSearchInput}
                onFilterChange={setFilterTerm}
                onSelectDistrict={(d) => {
                  const c = centroid(d.polygon) as [number, number]
                  setSelectedLocation({ lat: c[0], lng: c[1] })
                }}
              />
            </div>

            <button
              type="button"
              onClick={() => {
                setSearchInput('')
                setFilterTerm('')
                setSelectedLocation(null)
                map?.flyTo(defaultCenter, defaultZoom)
              }}
              className="absolute top-4 right-4 z-[1000] cursor-pointer rounded-2xl border border-slate-200 bg-white/95 px-3 py-2 text-xs font-bold text-slate-800 shadow-sm backdrop-blur hover:bg-white dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100"
            >
              {t('floodMap.resetView')}
            </button>

            <MapContainer
              center={center}
              zoom={12}
              scrollWheelZoom
              preferCanvas
              className="h-[32rem] w-full"
            >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
              <MapBridge onMap={setMap} />
              <FlyToSelectedLocation target={selectedLocation} />
              <ActualReportClickLayer />

              <FloodClustersLayer
                points={floodPoints}
                onSelectPoint={(p) => {
                  map?.flyTo(p.position, 15, { animate: true, duration: 0.6 })
                }}
                onSelectCluster={(lat, lng, nextZoom) => {
                  map?.flyTo([lat, lng], nextZoom, { animate: true, duration: 0.4 })
                }}
              />
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

type ActualStatus = 'dry' | 'light_lt20' | 'deep_gt50'

function ActualReportClickLayer() {
  const [popupLatLng, setPopupLatLng] = useState<{ lat: number; lng: number } | null>(null)

  useMapEvents({
    click: (e) => {
      setPopupLatLng({ lat: e.latlng.lat, lng: e.latlng.lng })
    },
  })

  if (!popupLatLng) return null

  const onSubmit = async (status: ActualStatus) => {
    await submitActualReport(popupLatLng.lat, popupLatLng.lng, status)
    setPopupLatLng(null)
    toast.success('Cảm ơn bạn đã gửi cập nhật thực tế.')
  }

  return (
    <Popup
      position={[popupLatLng.lat, popupLatLng.lng]}
      closeButton
      autoClose={false}
      closeOnClick={false}
      eventHandlers={{ remove: () => setPopupLatLng(null) }}
    >
      <div className="w-[270px] space-y-2">
        <div className="text-sm font-semibold text-slate-800">Tình trạng thực tế ở đây?</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void onSubmit('dry')}
            className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-700"
          >
            Khô ráo
          </button>
          <button
            type="button"
            onClick={() => void onSubmit('light_lt20')}
            className="rounded-lg bg-amber-500 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-amber-600"
          >
            Ngập nhẹ (&lt;20cm)
          </button>
          <button
            type="button"
            onClick={() => void onSubmit('deep_gt50')}
            className="rounded-lg bg-red-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-red-700"
          >
            Ngập sâu (&gt;50cm)
          </button>
        </div>
      </div>
    </Popup>
  )
}

async function submitActualReport(lat: number, lng: number, status: ActualStatus) {
  // Gọi API thật qua axios instance đã có interceptor JWT
  const { apiV1 } = await import('../utils/axiosConfig')
  await apiV1.post('/reports/actual-flood', { lat, lng, status })
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

