import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react'
import {
  CircleMarker, MapContainer, Marker, Popup, TileLayer, Tooltip,
  useMap, useMapEvents,
} from 'react-leaflet'
import type { LatLngExpression } from 'leaflet'
import * as L from 'leaflet'
import axios from 'axios'
import Supercluster from 'supercluster'
import { getLandslideBbox } from '../../../services/api'
import type { LandslideNode } from '../../../services/api'
import { cn } from '../../../utils/cn'

// ── Design tokens — khớp 100% với AQUAALERT dashboard ────────────────────────
const RISK_PALETTE = {
  DANGER:  { stroke: '#e11d48', fill: 'rgba(225,29,72,0.70)',  bg: 'bg-red-600',    text: 'Nguy hiểm',  emoji: '🔴' },
  WARNING: { stroke: '#f97316', fill: 'rgba(249,115,22,0.60)', bg: 'bg-orange-500', text: 'Cảnh báo',   emoji: '🟠' },
  SAFE:    { stroke: '#16a34a', fill: 'rgba(22,163,74,0.30)',  bg: 'bg-emerald-600',text: 'An toàn',    emoji: '🟢' },
} as const

type RiskKey = keyof typeof RISK_PALETTE

// Tile URLs — dùng chung với MapPage
const TILE_URLS = {
  terrain:   'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
  satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  streets:   'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
}

// ── Bounding box bao phủ toàn bộ Miền Bắc ────────────────────────────────────
const NORTH_VN_CENTER: LatLngExpression = [21.8, 104.5]
const NORTH_VN_ZOOM   = 7

// ── Helpers ───────────────────────────────────────────────────────────────────
function riskKey(node: LandslideNode): RiskKey {
  if (node.risk_level === 'DANGER')  return 'DANGER'
  if (node.risk_level === 'WARNING') return 'WARNING'
  return 'SAFE'
}

/** Bán kính CircleMarker tỉ lệ theo xác suất (7–22px) */
function nodeRadius(prob: number | null): number {
  const p = prob ?? 0
  return Math.min(22, 7 + p * 28)
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

// ── Supercluster types ────────────────────────────────────────────────────────
type NodePoint = LandslideNode & { cluster?: false }
type ClusterProps = { cluster: true; point_count: number }
type PointFeature   = GeoJSON.Feature<GeoJSON.Point, NodePoint>
type ClusterFeature = GeoJSON.Feature<GeoJSON.Point, ClusterProps & { cluster_id: number }>

// ═══════════════════════════════════════════════════════════════════════════════
// Sub: Layer clustering các điểm sạt lở
// ═══════════════════════════════════════════════════════════════════════════════
function LandslideClustersLayer({
  nodes,
  onSelectNode,
  onFlyToCluster,
}: {
  nodes: LandslideNode[]
  onSelectNode: (n: LandslideNode) => void
  onFlyToCluster: (lat: number, lng: number, zoom: number) => void
}) {
  const map = useMap()
  const indexRef = useRef<Supercluster<NodePoint, ClusterProps> | null>(null)

  const [view, setView] = useState(() => {
    const b = map.getBounds()
    return {
      zoom: map.getZoom(),
      bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] as [number,number,number,number],
    }
  })

  useMapEvents({
    moveend: () => { const b = map.getBounds(); setView({ zoom: map.getZoom(), bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] }) },
    zoomend: () => { const b = map.getBounds(); setView({ zoom: map.getZoom(), bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] }) },
  })

  const features = useMemo<PointFeature[]>(() =>
    nodes.map(n => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [n.lon, n.lat] },
      properties: { ...n, cluster: false as const },
    })), [nodes])

  useEffect(() => {
    const sc = new Supercluster<NodePoint, ClusterProps>({ radius: 55, maxZoom: 18 })
    sc.load(features)
    indexRef.current = sc
  }, [features])

  const clusters = useMemo(() => {
    const idx = indexRef.current
    if (!idx) return [] as Array<PointFeature | ClusterFeature>
    return idx.getClusters(view.bbox, Math.round(view.zoom)) as Array<PointFeature | ClusterFeature>
  }, [view])

  return (
    <>
      {clusters.map(f => {
        const [lng, lat] = f.geometry.coordinates
        const isCluster = Boolean((f.properties as any).cluster)

        if (isCluster) {
          const p = f as ClusterFeature
          const count = p.properties.point_count
          const size = clamp(32 + Math.log2(Math.max(2, count)) * 9, 32, 60)
          const icon = L.divIcon({
            className: '',
            html: `<div style="
              width:${size}px;height:${size}px;border-radius:50%;
              background:rgba(249,115,22,0.85);border:2.5px solid #f97316;
              color:#fff;font-size:12px;font-weight:900;
              display:flex;align-items:center;justify-content:center;
              box-shadow:0 0 16px rgba(249,115,22,0.5);
              backdrop-filter:blur(2px)
            ">${count}</div>`,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
          })
          return (
            <Marker
              key={`cl_${(p.properties as any).cluster_id}`}
              position={[lat, lng]}
              icon={icon}
              eventHandlers={{
                click: () => {
                  const idx = indexRef.current
                  if (!idx) return
                  const nextZoom = Math.min(
                    idx.getClusterExpansionZoom((p.properties as any).cluster_id),
                    18
                  )
                  onFlyToCluster(lat, lng, nextZoom)
                },
              }}
            />
          )
        }

        // ── Individual node marker ────────────────────────────────────────
        const n = (f as PointFeature).properties
        const risk = riskKey(n)
        const palette = RISK_PALETTE[risk]
        const radius = nodeRadius(n.prob_landslide)
        const prob = n.prob_landslide ?? 0

        return (
          <CircleMarker
            key={n.node_id}
            center={[lat, lng]}
            radius={radius}
            pathOptions={{
              color: palette.stroke,
              fillColor: palette.fill,
              weight: view.zoom >= 12 ? 1.5 : 1,
              opacity: 0.9,
              fillOpacity: clamp(0.35 + prob * 0.5, 0.35, 0.85),
            }}
            eventHandlers={{ click: () => onSelectNode(n) }}
          >
            {view.zoom >= 10 && (
              <Tooltip direction="top" className="fps-map-tooltip" opacity={1}>
                <div className="space-y-0.5">
                  <div className="text-[11px] font-extrabold">{n.province}</div>
                  <div className="text-[10px] text-slate-600 dark:text-slate-300">
                    {palette.emoji} {palette.text} · {Math.round(prob * 100)}%
                  </div>
                </div>
              </Tooltip>
            )}
          </CircleMarker>
        )
      })}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sub: FlyTo bridge — kích hoạt flyTo từ bên ngoài MapContainer
// ═══════════════════════════════════════════════════════════════════════════════
function FlyToTarget({ target }: { target: { lat: number; lng: number; zoom?: number } | null }) {
  const map = useMap()
  useEffect(() => {
    if (!target) return
    map.flyTo([target.lat, target.lng], target.zoom ?? 14, { animate: true, duration: 1.5 })
  }, [target?.lat, target?.lng, target?.zoom, map])
  return null
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sub: MapBridge — expose Leaflet instance ra ngoài MapContainer
// ═══════════════════════════════════════════════════════════════════════════════
function MapBridge({
  onMap,
  onBoundsChange,
}: {
  onMap: (m: L.Map) => void
  onBoundsChange: (b: L.LatLngBounds) => void
}) {
  const m = useMap()
  useEffect(() => { onMap(m) }, [m, onMap])
  useMapEvents({
    moveend: () => onBoundsChange(m.getBounds()),
    zoomend: () => onBoundsChange(m.getBounds()),
  })
  return null
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sub: Node detail Popup
// ═══════════════════════════════════════════════════════════════════════════════
function NodePopup({
  node,
  onClose,
}: {
  node: LandslideNode | null
  onClose: () => void
}) {
  if (!node) return null
  const risk = riskKey(node)
  const pal = RISK_PALETTE[risk]
  const prob = node.prob_landslide ?? 0
  const probPct = Math.round(prob * 100)

  return (
    <Popup
      position={[node.lat, node.lon]}
      closeButton
      autoClose={false}
      closeOnClick={false}
      eventHandlers={{ remove: () => setTimeout(onClose, 0) }}
    >
      <div className="w-[260px] space-y-2.5">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
          <div>
            <div className="text-xs font-extrabold uppercase tracking-wide text-slate-700">
              {node.province}
            </div>
            <div className="text-[10px] text-slate-400 font-mono">
              {node.lat.toFixed(4)}, {node.lon.toFixed(4)}
            </div>
          </div>
          <span className={cn(
            'rounded-full px-2.5 py-0.5 text-[10px] font-black text-white shadow-sm',
            risk === 'DANGER'  ? 'bg-red-600' :
            risk === 'WARNING' ? 'bg-orange-500' : 'bg-emerald-600'
          )}>
            {pal.emoji} {pal.text}
          </span>
        </div>

        {/* Probability gauge */}
        <div>
          <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
            <span>Xác suất sạt lở</span>
            <span className={cn('font-black text-sm',
              risk === 'DANGER'  ? 'text-red-600' :
              risk === 'WARNING' ? 'text-orange-500' : 'text-emerald-600'
            )}>{probPct}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${probPct}%`,
                background: risk === 'DANGER'
                  ? 'linear-gradient(90deg,#f97316,#e11d48)'
                  : risk === 'WARNING'
                    ? 'linear-gradient(90deg,#fbbf24,#f97316)'
                    : 'linear-gradient(90deg,#4ade80,#16a34a)',
                boxShadow: `0 0 8px ${pal.stroke}60`,
              }}
            />
          </div>
        </div>

        {/* 3-col metrics */}
        <div className="grid grid-cols-3 gap-1.5">
          <MetricChip
            label="Mưa 7 ngày"
            value={node.rain_7d_accum != null ? `${node.rain_7d_accum.toFixed(0)} mm` : '—'}
            icon="🌧"
            accent="sky"
          />
          <MetricChip
            label="Độ dốc"
            value={node.slope != null ? `${node.slope.toFixed(1)}°` : '—'}
            icon="📐"
            accent="amber"
          />
          <MetricChip
            label="Ẩm đất"
            value={node.soil_moisture_1d != null ? `${(node.soil_moisture_1d * 100).toFixed(0)}%` : '—'}
            icon="💧"
            accent="blue"
          />
        </div>

        {/* Extra: API index */}
        {node.api_7d != null && (
          <div className="flex items-center justify-between rounded-lg bg-orange-50 dark:bg-orange-950/30 px-3 py-1.5 text-[11px]">
            <span className="text-orange-600 dark:text-orange-400 font-semibold">
              API Tích lũy (7 ngày)
            </span>
            <span className="font-black text-orange-700 dark:text-orange-300">
              {node.api_7d.toFixed(1)} mm
            </span>
          </div>
        )}

        {/* Timestamp */}
        {node.prediction_time && (
          <div className="text-[9px] text-slate-400 text-right">
            Cập nhật: {new Date(node.prediction_time).toLocaleString('vi-VN')}
          </div>
        )}
      </div>
    </Popup>
  )
}

function MetricChip({
  label, value, icon, accent,
}: {
  label: string; value: string; icon: string
  accent: 'sky' | 'amber' | 'blue'
}) {
  const bg = {
    sky:   'bg-sky-50 dark:bg-sky-900/20 border-sky-100 dark:border-sky-800',
    amber: 'bg-amber-50 dark:bg-amber-900/20 border-amber-100 dark:border-amber-800',
    blue:  'bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-800',
  }[accent]
  const tx = {
    sky:   'text-sky-700 dark:text-sky-300',
    amber: 'text-amber-700 dark:text-amber-300',
    blue:  'text-blue-700 dark:text-blue-300',
  }[accent]
  return (
    <div className={cn('flex flex-col items-center gap-0.5 rounded-lg border p-1.5', bg)}>
      <span className="text-xs">{icon}</span>
      <span className={cn('text-[10px] font-black', tx)}>{value}</span>
      <span className="text-[9px] text-slate-400 text-center leading-tight">{label}</span>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN: LandslideMap
// ═══════════════════════════════════════════════════════════════════════════════

export type LandslideMapRef = {
  flyToWard: (lat: number, lng: number) => void
}

interface LandslideMapProps {
  /** Tile style — inherited from SettingsContext if passed */
  tileStyle?: 'terrain' | 'satellite' | 'streets'
  /** Optional ref to expose flyToWard imperatively */
  mapRef?: React.MutableRefObject<LandslideMapRef | null>
}

export function LandslideMap({ tileStyle = 'terrain', mapRef }: LandslideMapProps) {
  const [map, setMap] = useState<L.Map | null>(null)
  const [nodes, setNodes] = useState<LandslideNode[]>([])
  const [isFetching, setIsFetching] = useState(false)
  const [selectedNode, setSelectedNode] = useState<LandslideNode | null>(null)
  const [flyTarget, setFlyTarget] = useState<{ lat: number; lng: number; zoom?: number } | null>(null)
  const [riskFilter, setRiskFilter] = useState<'ALL' | 'WARNING' | 'DANGER'>('ALL')
  const abortRef = useRef<AbortController | null>(null)

  // ── Expose flyToWard imperatively ─────────────────────────────────────────
  const handleFlyToWard = useCallback((lat: number, lng: number) => {
    setFlyTarget({ lat, lng, zoom: 14 })
  }, [])

  useEffect(() => {
    if (mapRef) mapRef.current = { flyToWard: handleFlyToWard }
  }, [mapRef, handleFlyToWard])

  // ── Fetch landslide nodes khi bounds thay đổi ─────────────────────────────
  const fetchNodes = useCallback(async (bounds: L.LatLngBounds) => {
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setIsFetching(true)
    try {
      const data = await getLandslideBbox({
        minLat: bounds.getSouth(),
        maxLat: bounds.getNorth(),
        minLng: bounds.getWest(),
        maxLng: bounds.getEast(),
        limit: 3000,
        riskFilter,
      }, ctrl.signal)
      // Filter out nodes with <= 0% probability to improve performance
      setNodes(data.filter((n) => (n.prob_landslide ?? 0) > 0))
    } catch (err) {
      if (!axios.isCancel(err)) console.warn('[LandslideMap] fetch error:', err)
    } finally {
      setIsFetching(false)
    }
  }, [riskFilter])

  // ── Re-fetch khi riskFilter đổi ──────────────────────────────────────────
  useEffect(() => {
    if (!map) return
    const timer = setTimeout(() => fetchNodes(map.getBounds()), 200)
    return () => clearTimeout(timer)
  }, [map, riskFilter, fetchNodes])

  // Cleanup abort on unmount
  useEffect(() => () => { abortRef.current?.abort() }, [])

  // Counts
  const dangerCount  = useMemo(() => nodes.filter(n => n.risk_level === 'DANGER').length,  [nodes])
  const warningCount = useMemo(() => nodes.filter(n => n.risk_level === 'WARNING').length, [nodes])

  const tileUrl = TILE_URLS[tileStyle]
  const tileAttr =
    tileStyle === 'terrain'
      ? '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>'
      : tileStyle === 'satellite'
      ? '&copy; <a href="https://www.esri.com/">Esri</a>'
      : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

  return (
    <div className="relative h-full w-full">
      {/* ── Map Container ─────────────────────────────────────────────────── */}
      <MapContainer
        center={NORTH_VN_CENTER}
        zoom={NORTH_VN_ZOOM}
        maxZoom={18}
        scrollWheelZoom
        preferCanvas
        className="h-full w-full"
        style={{ minHeight: '520px' }}
      >
        <TileLayer url={tileUrl} attribution={tileAttr} />

        <MapBridge
          onMap={setMap}
          onBoundsChange={(b) => {
            const timer = setTimeout(() => fetchNodes(b), 300)
            // Note: the cleanup happens via useEffect above
            return timer
          }}
        />

        <FlyToTarget target={flyTarget} />

        <LandslideClustersLayer
          nodes={nodes}
          onSelectNode={(n) => {
            setSelectedNode(n)
            setFlyTarget({ lat: n.lat, lng: n.lon, zoom: 14 })
          }}
          onFlyToCluster={(lat, lng, zoom) =>
            setFlyTarget({ lat, lng, zoom })
          }
        />

        <NodePopup node={selectedNode} onClose={() => setSelectedNode(null)} />
      </MapContainer>

      {/* ── HUD: Loading indicator ─────────────────────────────────────────── */}
      {isFetching && (
        <div className="absolute top-3 left-1/2 z-[1000] -translate-x-1/2 flex items-center gap-2 rounded-full bg-slate-900/90 px-4 py-1.5 text-xs font-semibold text-white shadow-lg backdrop-blur">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-orange-400 border-t-transparent" />
          Đang tải dữ liệu sạt lở…
        </div>
      )}

      {/* ── HUD: Stats overlay top-left ───────────────────────────────────── */}
      <div className="absolute top-3 left-3 z-[1000] flex flex-col gap-1.5">
        <div className="flex items-center gap-2 rounded-xl bg-slate-900/85 px-3 py-1.5 text-xs font-bold text-white shadow-lg backdrop-blur">
          <span className="text-base">🏔</span>
          <span>Bản đồ Sạt lở Miền Bắc</span>
        </div>

        <div className="flex gap-1.5">
          <StatChip color="red" label="Nguy hiểm" count={dangerCount} />
          <StatChip color="orange" label="Cảnh báo" count={warningCount} />
        </div>
      </div>

      {/* ── HUD: Risk filter buttons ─────────────────────────────────────── */}
      <div className="absolute top-3 right-3 z-[1000] flex flex-col gap-1.5">
        {(['ALL', 'DANGER', 'WARNING'] as const).map(f => (
          <button
            key={f}
            type="button"
            onClick={() => setRiskFilter(f)}
            className={cn(
              'rounded-xl px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition-all shadow',
              riskFilter === f
                ? f === 'DANGER'  ? 'bg-red-600 text-white shadow-red-600/40'
                  : f === 'WARNING' ? 'bg-orange-500 text-white shadow-orange-500/40'
                  : 'bg-slate-700 text-white'
                : 'bg-slate-900/80 text-slate-300 hover:bg-slate-800/90 backdrop-blur'
            )}
          >
            {f === 'ALL' ? '🗺 Tất cả' : f === 'DANGER' ? '🔴 Nguy hiểm' : '🟠 Cảnh báo'}
          </button>
        ))}
      </div>

      {/* ── Legend ───────────────────────────────────────────────────────── */}
      <div className="absolute bottom-8 left-3 z-[1000] rounded-2xl bg-slate-900/90 p-3 text-[10px] text-white shadow-xl backdrop-blur space-y-1.5">
        <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1.5">Mức độ nguy cơ</div>
        {(Object.entries(RISK_PALETTE) as [RiskKey, typeof RISK_PALETTE[RiskKey]][]).map(([key, pal]) => (
          <div key={key} className="flex items-center gap-2">
            <span
              className="h-3 w-3 rounded-full flex-shrink-0"
              style={{ background: pal.stroke, boxShadow: `0 0 6px ${pal.stroke}80` }}
            />
            <span className="font-semibold">{pal.emoji} {pal.text}</span>
          </div>
        ))}
        <div className="mt-2 border-t border-slate-700 pt-1.5 text-[9px] text-slate-500">
          Radius ~ xác suất | Click node để xem chi tiết
        </div>
      </div>
    </div>
  )
}

// ── Stat chip helper ──────────────────────────────────────────────────────────
function StatChip({ color, label, count }: { color: 'red' | 'orange'; label: string; count: number }) {
  return (
    <div className={cn(
      'flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-[10px] font-bold shadow backdrop-blur',
      color === 'red'
        ? 'bg-red-600/80 text-white'
        : 'bg-orange-500/80 text-white',
    )}>
      <span className="tabular-nums font-black text-sm">{count.toLocaleString('vi-VN')}</span>
      <span className="opacity-90">{label}</span>
    </div>
  )
}
