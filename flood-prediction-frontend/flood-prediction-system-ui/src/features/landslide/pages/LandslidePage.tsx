import { useCallback, useEffect, useRef, useState } from 'react'
import { LandslideMap, type LandslideMapRef } from '../components/LandslideMap'
import { LANDSLIDE_HOTSPOTS } from '../components/LandslideHotspotCards'
import { cn } from '../../../utils/cn'
import { getLandslideHotspots } from '../../../services/api'

// ── Hotspot compact card dùng riêng cho page này ────────────────────────────
type HotspotCardProps = (typeof LANDSLIDE_HOTSPOTS)[number] & {
  onFly: (lat: number, lng: number) => void
  isFocused: boolean
}

function HotspotCard({ name, province, risk, soilMoisture, rain7d, slope, lat, lng, onFly, isFocused }: HotspotCardProps) {
  const isCritical = risk === 'critical'
  return (
    <button
      type="button"
      onClick={() => onFly(lat, lng)}
      className={cn(
        'group flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-all duration-300',
        'hover:-translate-y-0.5 hover:shadow-xl active:scale-95',
        isFocused
          ? isCritical
            ? 'border-red-500/60 bg-red-950/40 shadow-red-600/20 shadow-lg'
            : 'border-orange-500/60 bg-orange-950/40 shadow-orange-500/20 shadow-lg'
          : isCritical
          ? 'border-red-500/20 bg-slate-900/60'
          : 'border-orange-500/20 bg-slate-900/60',
      )}
    >
      {/* Icon */}
      <div
        className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-xl text-xl"
        style={{
          background: isCritical ? 'rgba(239,68,68,0.15)' : 'rgba(249,115,22,0.15)',
          border: `1px solid ${isCritical ? 'rgba(239,68,68,0.35)' : 'rgba(249,115,22,0.35)'}`,
        }}
      >
        🏔
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-extrabold text-white truncate">{name}</span>
          <span
            className={cn(
              'flex-shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest',
              isCritical ? 'bg-red-600/25 text-red-300 ring-1 ring-red-500/40' : 'bg-orange-500/25 text-orange-300 ring-1 ring-orange-500/40',
            )}
          >
            {isCritical ? '🔴 Rất cao' : '🟠 Cảnh báo'}
          </span>
        </div>
        <div className="mt-0.5 text-[10px] text-slate-400">{province}</div>
        {/* Mini metrics */}
        <div className="mt-1.5 flex gap-3 text-[10px]">
          <span className="text-blue-400">🌧 {rain7d} mm</span>
          <span className="text-amber-400">📐 {slope}°</span>
          <span className={soilMoisture >= 80 ? 'text-red-400' : 'text-orange-400'}>
            💧 {soilMoisture}%
          </span>
        </div>
      </div>

      {/* Fly arrow */}
      <div className="flex-shrink-0 text-slate-600 transition-all group-hover:translate-x-0.5 group-hover:text-orange-400">
        ✈
      </div>
    </button>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// LandslidePage — trang bản đồ sạt lở đầy đủ
// ═══════════════════════════════════════════════════════════════════════════════
export function LandslidePage() {
  const mapRef = useRef<LandslideMapRef | null>(null)
  const [focusedSpot, setFocusedSpot] = useState<string | null>(null)
  const [tileStyle, setTileStyle] = useState<'terrain' | 'satellite' | 'streets'>('terrain')
  const [hotspots, setHotspots] = useState<Array<{
    id: string
    name: string
    province: string
    risk: 'critical' | 'warning'
    soilMoisture: number
    rain7d: number
    slope: number
    ndvi: number
    lat: number
    lng: number
  }>>([])
  const [loadingHotspots, setLoadingHotspots] = useState(true)

  // Tải các điểm nóng động từ backend thật, fallback về mock dữ liệu nếu rỗng hoặc lỗi
  useEffect(() => {
    let active = true
    async function fetchDynamicHotspots() {
      try {
        setLoadingHotspots(true)
        const data = await getLandslideHotspots(10)
        if (!active) return
        if (data && data.length > 0) {
          const formatted = data.map(node => ({
            id: node.node_id,
            name: `${node.province} - Node ${node.node_id.slice(0, 6)}`,
            province: node.province,
            risk: node.risk_level === 'DANGER' ? ('critical' as const) : ('warning' as const),
            soilMoisture: node.soil_moisture_1d ? Math.round(node.soil_moisture_1d * 100) : 0,
            rain7d: node.rain_7d_accum ? Math.round(node.rain_7d_accum) : 0,
            slope: node.slope ? Math.round(node.slope) : 0,
            ndvi: node.ndvi ?? 0.35,
            lat: node.lat,
            lng: node.lon,
          }))
          setHotspots(formatted)
        } else {
          setHotspots(LANDSLIDE_HOTSPOTS)
        }
      } catch (err) {
        console.warn('[LandslidePage] Không thể load hotspots từ backend, fallback về static data:', err)
        if (active) {
          setHotspots(LANDSLIDE_HOTSPOTS)
        }
      } finally {
        if (active) setLoadingHotspots(false)
      }
    }
    fetchDynamicHotspots()
    return () => {
      active = false
    }
  }, [])

  /** handleFlyToWard — được gọi từ HotspotCard và cho phép sử dụng bên ngoài qua mapRef */
  const handleFlyToWard = useCallback((lat: number, lng: number, id?: string) => {
    mapRef.current?.flyToWard(lat, lng)
    setFocusedSpot(id ?? null)
  }, [])

  return (
    <div className="flex h-[calc(100vh-80px)] flex-col gap-4">
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            🏔 Bản đồ Cảnh báo Sạt lở Miền Bắc
          </h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Dự báo real-time từ mô hình ONNX ML v7 · 425.180 điểm giám sát
          </p>
        </div>

        {/* Tile style switcher */}
        <div className="flex gap-1.5 rounded-xl border border-slate-200 bg-white/80 p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900/80 backdrop-blur">
          {(['terrain', 'satellite', 'streets'] as const).map(style => (
            <button
              key={style}
              type="button"
              onClick={() => setTileStyle(style)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide transition-all',
                tileStyle === style
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800',
              )}
            >
              {style === 'terrain' ? '🗻 Địa hình' : style === 'satellite' ? '🛰 Vệ tinh' : '🗺 Đường phố'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Main content: Map + Sidebar ─────────────────────────────────── */}
      <div className="grid flex-1 grid-cols-12 gap-4 overflow-hidden">

        {/* ── Map: 8/12 columns ──────────────────────────────────────────── */}
        <div className="col-span-12 overflow-hidden rounded-2xl border border-slate-200 shadow-lg dark:border-slate-800 lg:col-span-8">
          <LandslideMap tileStyle={tileStyle} mapRef={mapRef} />
        </div>

        {/* ── Sidebar: 4/12 columns ─────────────────────────────────────── */}
        <div className="col-span-12 flex flex-col gap-3 overflow-y-auto lg:col-span-4">

          {/* Hotspot panel */}
          <div
            className="rounded-2xl border p-4 space-y-2"
            style={{
              background: 'linear-gradient(145deg, rgba(15,10,8,0.97), rgba(20,12,8,0.95))',
              borderColor: 'rgba(249,115,22,0.2)',
              boxShadow: '0 0 40px rgba(249,115,22,0.06)',
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-extrabold text-white">🔥 Điểm Nóng Sạt Lở</div>
                <div className="text-[10px] text-slate-500">Click để bay đến vị trí cấp Xã</div>
              </div>
              {focusedSpot && (
                <button
                  type="button"
                  onClick={() => setFocusedSpot(null)}
                  className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
                >
                  ✕ Bỏ chọn
                </button>
              )}
            </div>

            <div className="space-y-2">
              {loadingHotspots ? (
                <div className="flex flex-col items-center justify-center py-8 text-slate-400 gap-2">
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
                  <span className="text-xs">Đang tải điểm nóng sạt lở…</span>
                </div>
              ) : hotspots.length === 0 ? (
                <div className="text-center py-6 text-xs text-slate-500">
                  Không tìm thấy điểm nóng nào.
                </div>
              ) : (
                hotspots.map(spot => (
                  <HotspotCard
                    key={spot.id}
                    {...spot}
                    isFocused={focusedSpot === spot.id}
                    onFly={(lat, lng) => handleFlyToWard(lat, lng, spot.id)}
                  />
                ))
              )}
            </div>
          </div>

          {/* Info panel */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm font-extrabold text-slate-800 dark:text-white">📊 Thông tin Mô hình</div>

            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Phiên bản', value: 'ML v7 (RF)', icon: '🤖' },
                { label: 'Nodes', value: '425.180', icon: '📍' },
                { label: 'Threshold', value: '0.0937', icon: '⚖️' },
                { label: 'Cập nhật', value: '0h & 12h/ngày', icon: '🕐' },
              ].map(item => (
                <div
                  key={item.label}
                  className="flex flex-col rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800"
                >
                  <span className="text-xs text-slate-400">{item.icon} {item.label}</span>
                  <span className="mt-0.5 text-sm font-black text-slate-800 dark:text-white">{item.value}</span>
                </div>
              ))}
            </div>

            <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
              💡 <strong>Mẹo:</strong> Dùng bộ lọc trên bản đồ để chỉ hiển thị vùng NGUY HIỂM hoặc CẢNH BÁO.
            </div>
            <div className="rounded-xl bg-sky-50 p-3 text-xs text-sky-700 dark:bg-sky-950/30 dark:text-sky-300">
              🖱 <strong>Click node</strong> để xem chi tiết: xác suất, lượng mưa, độ ẩm đất.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
