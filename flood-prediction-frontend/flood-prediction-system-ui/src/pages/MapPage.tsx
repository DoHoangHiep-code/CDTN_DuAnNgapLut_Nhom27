import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import type { LatLngExpression } from 'leaflet'
import * as L from 'leaflet'
import axios from 'axios'
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
import { formatDepthCm } from '../utils/floodDepth'
import Supercluster from 'supercluster'
import { LocationSearch, type NominatimResult } from '../components/LocationSearch'
import { FloodReportModal } from '../components/FloodReportModal'
import { FloodWarningCard } from '../components/FloodWarningCard'
import { useSettings } from '../context/SettingsContext'

// Tile URLs cho từng kiểu bản đồ
const TILE_URLS: Record<string, string> = {
  streets: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  terrain: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
}

const TILE_ATTRIBUTIONS: Record<string, string> = {
  streets: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  satellite: '&copy; <a href="https://www.esri.com/">Esri</a>',
  terrain: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
}

// ───────────────────────────────────────────────────────────────
// Màu sắc vùng ngập
// ───────────────────────────────────────────────────────────────
const RISK_FILL: Record<RiskLevel, { color: string; fillColor: string }> = {
  safe: { color: '#16a34a', fillColor: 'rgba(22,163,74,0.25)' },
  medium: { color: '#f59e0b', fillColor: 'rgba(245,158,11,0.25)' },
  high: { color: '#f97316', fillColor: 'rgba(249,115,22,0.25)' },
  severe: { color: '#e11d48', fillColor: 'rgba(225,29,72,0.25)' },
}

// Tính centroid (điểm trung tâm) của polygon để đặt marker
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

// Chuyển độ sâu ngập (cm) thành màu heat-map: vàng → cam → đỏ
function heatColor(depthCm: number) {
  const t = clamp(depthCm / 100, 0, 1)
  if (t <= 0.33) return `rgb(${Math.round(255)},${Math.round(200 - 80 * (t / 0.33))},${Math.round(60)})`
  if (t <= 0.66) return `rgb(${Math.round(255)},${Math.round(120 - 90 * ((t - 0.33) / 0.33))},${Math.round(40)})`
  return `rgb(${Math.round(230 - 40 * ((t - 0.66) / 0.34))},${Math.round(30)},${Math.round(30)})`
}

// ───────────────────────────────────────────────────────────────
// Kiểu dữ liệu
// ───────────────────────────────────────────────────────────────
type FloodPoint = {
  id: string
  name: string
  risk: RiskLevel
  predictedRainfallMm: number
  depthCm: number
  position: LatLngExpression
}

type ClusterProps = { cluster: true; point_count: number }
type PointFeature = GeoJSON.Feature<GeoJSON.Point, FloodPoint & { cluster?: false }>
type ClusterFeature = GeoJSON.Feature<GeoJSON.Point, ClusterProps & { cluster_id: number }>

// ───────────────────────────────────────────────────────────────
// Layer: Cluster các điểm ngập
// ───────────────────────────────────────────────────────────────
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
    moveend: () => { const b = map.getBounds(); setView({ zoom: map.getZoom(), bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] }) },
    zoomend: () => { const b = map.getBounds(); setView({ zoom: map.getZoom(), bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] }) },
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
    const sc = new Supercluster<FloodPoint, ClusterProps>({ radius: 60, maxZoom: 18, minZoom: 0 })
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
          const icon = L.divIcon({ html: iconHtml, className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2] })
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
            pathOptions={{ color, fillColor: color, weight: 1, opacity: isMaxZoom ? 0.6 : 0.9, fillOpacity: isMaxZoom ? 0.6 : 0.35 }}
            eventHandlers={{ click: () => onSelectPoint(p) }}
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

// ───────────────────────────────────────────────────────────────
// Sub-component: Fly đến tọa độ đã chọn (dùng useMap để truy cập
// Leaflet instance bên trong MapContainer)
// ───────────────────────────────────────────────────────────────
function FlyToSelectedLocation({ target }: { target: { lat: number; lng: number } | null }) {
  const map = useMap()
  useEffect(() => {
    if (!target) return
    // Animate mượt mà đến tọa độ với zoom 14 và duration 1.5 giây
    map.flyTo([target.lat, target.lng], 14, { animate: true, duration: 1.5 })
  }, [target?.lat, target?.lng, map])
  return null
}

// ───────────────────────────────────────────────────────────────
// Sub-component: Marker "Pulse" tại điểm tìm kiếm từ Nominatim
// Hiển thị vòng tròn rung để thu hút sự chú ý
// ───────────────────────────────────────────────────────────────
function SearchPulseMarker({ position }: { position: [number, number] }) {
  // Dùng divIcon để tạo hiệu ứng pulse custom bằng CSS
  const icon = useMemo(() => L.divIcon({
    className: '',
    html: `<div class="fps-search-pulse">
             <div class="fps-search-pulse__ring"></div>
             <div class="fps-search-pulse__dot"></div>
           </div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  }), [])

  return <Marker position={position} icon={icon} />
}

// ───────────────────────────────────────────────────────────────
// Sub-component: Lấy địa chỉ thực tế khi click bản đồ (Reverse Geocoding)
// Gọi Nominatim /reverse API và hiển thị Popup với địa chỉ
// ───────────────────────────────────────────────────────────────
function ReverseGeocodeLayer({ onOpenReport }: { onOpenReport: () => void }) {
  const [popupData, setPopupData] = useState<{
    lat: number; lng: number; address: string | null; loading: boolean
  } | null>(null)

  useMapEvents({
    click: async (e) => {
      const { lat, lng } = e.latlng

      // Hiện popup ngay với trạng thái loading
      setPopupData({ lat, lng, address: null, loading: true })

      try {
        // Gọi Nominatim Reverse Geocoding để lấy địa chỉ từ tọa độ
        const res = await axios.get<{ display_name: string }>(
          'https://nominatim.openstreetmap.org/reverse',
          {
            params: { format: 'json', lat, lon: lng },
            headers: {
              'Accept-Language': 'vi,en',
              // KHÔNG đặt User-Agent ở đây: trình duyệt cấm ghi đè Forbidden Header này
            },
          },
        )
        setPopupData({ lat, lng, address: res.data.display_name, loading: false })
      } catch {
        setPopupData({ lat, lng, address: 'Không thể lấy địa chỉ.', loading: false })
      }
    },
  })

  if (!popupData) return null

  return (
    <Popup
      position={[popupData.lat, popupData.lng]}
      closeButton
      autoClose={false}
      closeOnClick={false}
      eventHandlers={{ remove: () => setPopupData(null) }}
    >
      <div className="w-[280px] space-y-2.5">
        {/* Tiêu đề popup */}
        <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
          Địa điểm được chọn
        </div>

        {/* Địa chỉ hoặc loading */}
        {popupData.loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
            Đang tra địa chỉ…
          </div>
        ) : (
          <div className="text-sm leading-snug text-slate-800">{popupData.address}</div>
        )}

        {/* Tọa độ chính xác */}
        <div className="rounded-md bg-slate-50 px-2 py-1.5 font-mono text-[11px] text-slate-500">
          {popupData.lat.toFixed(6)}, {popupData.lng.toFixed(6)}
        </div>

        {/* Nút mở FloodReportModal để báo cáo chi tiết */}
        <button
          type="button"
          onClick={() => { setPopupData(null); onOpenReport() }}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 text-xs font-bold text-white hover:bg-rose-700"
        >
          🚨 Báo cáo tình trạng ngập tại đây
        </button>
      </div>
    </Popup>
  )
}



// ───────────────────────────────────────────────────────────────
// Sub-component: Cầu nối để lấy instance Leaflet Map ra ngoài
// MapContainer (useMap chỉ hoạt động được bên trong MapContainer)
// ───────────────────────────────────────────────────────────────
function MapBridge({ onMap, onCenter }: { onMap: (m: L.Map) => void; onCenter: (lat: number, lon: number) => void }) {
  const m = useMap()
  useEffect(() => { onMap(m) }, [m, onMap])

  // Cập nhật center khi map di chuyển hoặc zoom
  useMapEvents({
    moveend: () => {
      const c = m.getCenter()
      onCenter(c.lat, c.lng)
    },
  })
  return null
}

// ───────────────────────────────────────────────────────────────
// Component chính: MapPage
// ───────────────────────────────────────────────────────────────
export function MapPage() {
  const { t } = useTranslation()
  const { showRiskOverlay, showFloodMarkers, mapStyle } = useSettings()
  const flood = useAsync(getFloodPrediction, [])
  const weather = useAsync(getWeather, [])

  const [searchInput, setSearchInput] = useState('')
  const [filterTerm, setFilterTerm] = useState('')

  // Vị trí đã chọn để flyTo – có thể từ quận nội bộ hoặc kết quả Nominatim
  const [selectedLocation, setSelectedLocation] = useState<{ lat: number; lng: number } | null>(null)

  // Marker pulse tại vị trí tìm kiếm từ Nominatim (khác với quận nội bộ)
  const [pulseMarker, setPulseMarker] = useState<[number, number] | null>(null)

  // State điều khiển mở/đóng modal gửi báo cáo ngập lụt
  const [reportModalOpen, setReportModalOpen] = useState(false)

  // Tọa độ tâm bản đồ – dùng để cấp cho FloodWarningCard
  const [mapCenter, setMapCenter] = useState({ lat: 21.0278, lon: 105.8342 })

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
      const depthCm = d.flood_depth_cm ?? 0
      return { id: d.id, name: d.name, risk: d.risk, predictedRainfallMm: d.predictedRainfallMm, depthCm, position }
    })
  }, [filteredDistricts])

  // Fly đến quận từ URL param khi dữ liệu sẵn sàng
  useEffect(() => {
    if (!map || !districtFromUrl) return
    const pos = centroid(districtFromUrl.polygon)
    map.flyTo(pos, 15, { animate: true, duration: 0.6 })
  }, [map, districtFromUrl])

  // Xử lý chọn kết quả từ Nominatim geocoding
  const handleGeoResult = useCallback((result: NominatimResult) => {
    const lat = parseFloat(result.lat)
    const lon = parseFloat(result.lon)
    if (isNaN(lat) || isNaN(lon)) return

    // Cập nhật vị trí để FlyToSelectedLocation kích hoạt flyTo
    setSelectedLocation({ lat, lng: lon })
    // Đặt marker pulse tại điểm đã tìm
    setPulseMarker([lat, lon])
  }, [])

  // Xử lý reset tìm kiếm và về trung tâm mặc định
  const handleResetView = useCallback(() => {
    setSearchInput('')
    setFilterTerm('')
    setSelectedLocation(null)
    setPulseMarker(null)
    map?.flyTo(defaultCenter, defaultZoom)
  }, [map])

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
            {/* ── Thanh tìm kiếm nổi trên bản đồ ── */}
            <div className="absolute top-4 left-4 z-[1000] w-full max-w-sm pointer-events-auto">
              <LocationSearch
                districts={flood.data.districts}
                placeholder={t('floodMap.searchDistrict')}
                value={searchInput}
                onChange={setSearchInput}
                onFilterChange={setFilterTerm}
                onSelectDistrict={(d) => {
                  // Chọn quận từ dữ liệu nội bộ → fly đến centroid
                  const c = centroid(d.polygon) as [number, number]
                  setSelectedLocation({ lat: c[0], lng: c[1] })
                  // Xoá pulse marker cũ (không cần cho quận nội bộ)
                  setPulseMarker(null)
                }}
                onSelectGeoResult={handleGeoResult}
              />
            </div>

            {/* ── Nút Reset về mặc định ── */}
            <button
              type="button"
              onClick={handleResetView}
              className="absolute top-4 right-4 z-[1000] cursor-pointer rounded-2xl border border-slate-200 bg-white/95 px-3 py-2 text-xs font-bold text-slate-800 shadow-sm backdrop-blur hover:bg-white dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100"
            >
              {t('floodMap.resetView')}
            </button>

            {/* ── Nút mở modal Báo cáo ngập (bottom-right của bản đồ) ── */}
            <button
              type="button"
              onClick={() => setReportModalOpen(true)}
              className="absolute bottom-5 right-4 z-[1000] flex cursor-pointer items-center gap-2 rounded-2xl border border-rose-200 bg-rose-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg backdrop-blur transition hover:bg-rose-700 active:scale-95 dark:border-rose-700"
            >
              {/* Icon cảnh báo ngập */}
              <span className="text-base leading-none">🚨</span>
              Báo cáo ngập
            </button>

            {/* ── FloodWarningCard: Bảng dự đoán nổi góc dưới trái ── */}
            <FloodWarningCard
              lat={mapCenter.lat}
              lon={mapCenter.lon}
            />

            {/* ── Leaflet MapContainer ── */}
            <MapContainer
              center={center}
              zoom={12}
              scrollWheelZoom
              preferCanvas
              className="h-[32rem] w-full"
            >
              <TileLayer
                attribution={TILE_ATTRIBUTIONS[mapStyle]}
                url={TILE_URLS[mapStyle]}
              />

              {/* Cầu nối để lấy Leaflet map instance và theo dõi center map */}
              <MapBridge
                onMap={setMap}
                onCenter={(lat, lon) => setMapCenter({ lat, lon })}
              />

              {/* Fly đến vị trí đã chọn (cả quận nội bộ lẫn Nominatim) */}
              <FlyToSelectedLocation target={selectedLocation} />

              {/* Marker pulse tại điểm tìm kiếm Nominatim */}
              {pulseMarker && <SearchPulseMarker position={pulseMarker} />}

              {/* Reverse geocoding: click bản đồ → hiện địa chỉ + báo cáo */}
              <ReverseGeocodeLayer onOpenReport={() => setReportModalOpen(true)} />

              {/* Các điểm ngập (có clustering) — ẩn khi tắt showFloodMarkers */}
              {showFloodMarkers && (
                <FloodClustersLayer
                  points={showRiskOverlay ? floodPoints : []}
                  onSelectPoint={(p) => {
                    map?.flyTo(p.position, 15, { animate: true, duration: 0.6 })
                  }}
                  onSelectCluster={(lat, lng, nextZoom) => {
                    map?.flyTo([lat, lng], nextZoom, { animate: true, duration: 0.4 })
                  }}
                />
              )}
            </MapContainer>
          </div>
        </div>

        {/* ── Chú thích mức độ rủi ro ── */}
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

          {/* Gợi ý tính năng cho người dùng */}
          <div className="mt-4 space-y-2">
            <div className="rounded-xl bg-sky-50 p-3 text-xs text-sky-700 dark:bg-sky-950/30 dark:text-sky-300">
              💡 <strong>Tìm kiếm:</strong> Nhập tên địa điểm để lọc bản đồ và fly đến tọa độ.
            </div>
            <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-950/40 dark:text-slate-300">
              🖱 <strong>Click bản đồ:</strong> Xem địa chỉ và báo cáo tình trạng thực tế.
            </div>
          </div>

          <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-950/40 dark:text-slate-400">
            Geocoding: OpenStreetMap Nominatim API
          </div>
        </Card>
      </div>

      {/* ── Modal Báo cáo ngập lụt ── */}
      {/* Render ngoài luồng DOM bình thường nhờ fixed positioning trong FloodReportModal */}
      <FloodReportModal
        open={reportModalOpen}
        onClose={() => setReportModalOpen(false)}
        onSubmit={async ({ lat, lng, level, note }) => {
          // Gọi API backend gửi báo cáo thực tế
          const { apiV1 } = await import('../utils/axiosConfig')
          await apiV1.post('/reports/actual-flood', { lat, lng, severity: level, note })
          toast.success('Báo cáo ngập đã được gửi. Cảm ơn bạn!')
          setReportModalOpen(false)
        }}
      />
    </div>
  )
}

// ───────────────────────────────────────────────────────────────
// Hàng chú thích màu sắc vùng ngập
// ───────────────────────────────────────────────────────────────
function LegendRow({ label, level }: { label: string; level: RiskLevel }) {
  const s = RISK_FILL[level]
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="h-3.5 w-3.5 rounded" style={{ backgroundColor: s.fillColor, outline: `2px solid ${s.color}` }} />
        <span className="font-semibold text-slate-800 dark:text-slate-100">{label}</span>
      </div>
      <RiskBadge level={level} />
    </div>
  )
}
