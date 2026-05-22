import { useCallback, useEffect, useRef, useState } from 'react'
import { LandslideMap, type LandslideMapRef } from '../components/LandslideMap'
import { LANDSLIDE_HOTSPOTS } from '../components/LandslideHotspotCards'
import { cn } from '../../../utils/cn'
import { getLandslideHotspots } from '../../../services/api'

// ── Màu theme sạt lở: đất/núi (amber-red-stone) ────────────────────────────
const LS = {
  pageBg:        'bg-stone-50 dark:bg-stone-950',
  sidebarBg:     'bg-gradient-to-b from-stone-900 via-stone-900 to-stone-950',
  cardBorder:    'border-stone-200 dark:border-stone-800',
  cardBg:        'bg-white dark:bg-stone-900',
  panelBg:       'rgba(28,22,18,0.98)',
  panelBorder:   'rgba(217,119,6,0.22)',
  criticalColor: '#dc2626',
  warningColor:  '#d97706',
}

type HotspotCardProps = (typeof LANDSLIDE_HOTSPOTS)[number] & {
  onFly: (lat: number, lng: number) => void
  isFocused: boolean
}

function HotspotCard({ name, province, risk, soilMoisture, rain7d, slope, lat, lng, onFly, isFocused }: HotspotCardProps) {
  const isCritical = risk === 'critical'
  const accent = isCritical ? LS.criticalColor : LS.warningColor
  const moistureColor = soilMoisture >= 85 ? '#dc2626' : soilMoisture >= 70 ? '#d97706' : '#ca8a04'

  return (
    <button
      type="button"
      onClick={() => onFly(lat, lng)}
      className={cn(
        'group relative w-full overflow-hidden rounded-xl border text-left transition-all duration-200',
        'hover:-translate-y-px hover:shadow-xl active:scale-[0.985]',
        isFocused
          ? isCritical
            ? 'border-red-700/50 shadow-md shadow-red-900/30'
            : 'border-amber-600/50 shadow-md shadow-amber-900/30'
          : 'border-stone-700/40 hover:border-stone-600/60',
      )}
      style={{
        background: isFocused
          ? isCritical
            ? 'linear-gradient(135deg, rgba(40,12,12,0.99), rgba(55,16,16,0.97))'
            : 'linear-gradient(135deg, rgba(38,24,8,0.99), rgba(52,30,8,0.97))'
          : 'linear-gradient(135deg, rgba(26,20,16,0.98), rgba(32,24,18,0.96))',
      }}
    >
      {/* Left accent bar */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px]"
        style={{ background: accent, opacity: isFocused ? 1 : 0.45 }}
      />

      <div className="flex items-center gap-3 px-3 py-2.5 pl-4">
        {/* Mountain icon */}
        <div
          className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg text-base"
          style={{
            background: `${accent}18`,
            border: `1px solid ${accent}35`,
          }}
        >
          {isCritical ? '🏔' : '⛰'}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[13px] font-bold text-stone-100">{name}</span>
            <span
              className="flex-shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest"
              style={{
                background: `${accent}20`,
                color: isCritical ? '#fca5a5' : '#fcd34d',
                border: `1px solid ${accent}40`,
              }}
            >
              {isCritical ? '● Rất cao' : '● Cảnh báo'}
            </span>
          </div>

          <div className="mt-0.5 text-[10px] text-stone-500">{province}</div>

          {/* Moisture bar */}
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1 flex-1 rounded-full bg-stone-800">
              <div
                className="h-full rounded-full"
                style={{ width: `${soilMoisture}%`, background: moistureColor }}
              />
            </div>
            <span className="text-[10px] font-bold" style={{ color: moistureColor }}>
              💧{soilMoisture}%
            </span>
          </div>

          <div className="mt-1 flex gap-3 text-[10px] text-stone-500">
            <span className="text-sky-400">🌧 {rain7d}mm</span>
            <span className="text-amber-500">📐 {slope}°</span>
          </div>
        </div>

        <div
          className="flex-shrink-0 transition-all duration-150 group-hover:translate-x-0.5"
          style={{ color: isFocused ? accent : 'rgba(120,113,108,0.5)' }}
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </button>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
export function LandslidePage() {
  const mapRef = useRef<LandslideMapRef | null>(null)
  const [focusedSpot, setFocusedSpot] = useState<string | null>(null)
  const [tileStyle, setTileStyle] = useState<'terrain' | 'satellite' | 'streets'>('terrain')
  const [hotspots, setHotspots] = useState<Array<{
    id: string; name: string; province: string; risk: 'critical' | 'warning'
    soilMoisture: number; rain7d: number; slope: number; ndvi: number; lat: number; lng: number
  }>>([])
  const [loadingHotspots, setLoadingHotspots] = useState(true)

  useEffect(() => {
    let active = true
    async function fetchDynamicHotspots() {
      try {
        setLoadingHotspots(true)
        const data = await getLandslideHotspots(10)
        if (!active) return
        if (data && data.length > 0) {
          setHotspots(data.map(node => ({
            id: node.node_id,
            name: `${node.province} – Node ${node.node_id.slice(0, 6)}`,
            province: node.province,
            risk: node.risk_level === 'DANGER' ? ('critical' as const) : ('warning' as const),
            soilMoisture: node.soil_moisture_1d ? Math.round(node.soil_moisture_1d * 100) : 0,
            rain7d: node.rain_7d_accum ? Math.round(node.rain_7d_accum) : 0,
            slope: node.slope ? Math.round(node.slope) : 0,
            ndvi: node.ndvi ?? 0.35,
            lat: node.lat, lng: node.lon,
          })))
        } else {
          setHotspots(LANDSLIDE_HOTSPOTS)
        }
      } catch {
        if (active) setHotspots(LANDSLIDE_HOTSPOTS)
      } finally {
        if (active) setLoadingHotspots(false)
      }
    }
    fetchDynamicHotspots()
    return () => { active = false }
  }, [])

  const handleFlyToWard = useCallback((lat: number, lng: number, id?: string) => {
    mapRef.current?.flyToWard(lat, lng)
    setFocusedSpot(id ?? null)
  }, [])

  const criticalCount = hotspots.filter(h => h.risk === 'critical').length
  const warningCount  = hotspots.filter(h => h.risk === 'warning').length

  const tileOptions = [
    { key: 'terrain'   as const, label: 'Địa hình', icon: '🗻' },
    { key: 'satellite' as const, label: 'Vệ tinh',  icon: '🛰' },
    { key: 'streets'   as const, label: 'Đường phố', icon: '🗺' },
  ]

  return (
    <div className="flex h-[calc(100vh-80px)] flex-col gap-4">

      {/* ── Header banner ──────────────────────────────────────────────────── */}
      <div
        className="relative overflow-hidden rounded-2xl px-5 py-4 shadow-lg"
        style={{
          background: 'linear-gradient(120deg, #1c1208 0%, #2d1a08 40%, #1a0f0f 100%)',
          border: '1px solid rgba(217,119,6,0.28)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)',
        }}
      >
        {/* Decorative mountain silhouette */}
        <svg
          className="pointer-events-none absolute bottom-0 right-0 h-full opacity-[0.06]"
          viewBox="0 0 400 120" preserveAspectRatio="xMaxYMax meet"
        >
          <path d="M0 120 L80 40 L140 80 L220 10 L300 70 L360 30 L400 60 L400 120 Z" fill="#d97706" />
        </svg>

        {/* Glow accent */}
        <div
          className="pointer-events-none absolute -top-10 right-1/3 h-40 w-40 rounded-full opacity-20 blur-3xl"
          style={{ background: 'radial-gradient(circle, #d97706, transparent)' }}
        />

        <div className="relative flex flex-wrap items-center justify-between gap-4">
          {/* Left: icon + title */}
          <div className="flex items-center gap-4">
            <div
              className="hidden sm:grid h-14 w-14 flex-shrink-0 place-items-center rounded-2xl text-3xl shadow-xl"
              style={{
                background: 'linear-gradient(135deg, rgba(217,119,6,0.3), rgba(220,38,38,0.2))',
                border: '1px solid rgba(217,119,6,0.4)',
                boxShadow: '0 0 24px rgba(217,119,6,0.2)',
              }}
            >
              🏔
            </div>
            <div>
              <h2 className="text-xl font-extrabold tracking-tight text-amber-50">
                Bản đồ Cảnh báo Sạt lở Miền Bắc
              </h2>
              <p className="mt-0.5 text-xs text-amber-200/50">
                Dự báo real-time · Mô hình ONNX ML v7 · 425.180 điểm giám sát
              </p>
              {/* Status dots */}
              {!loadingHotspots && (
                <div className="mt-2 flex items-center gap-3">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-red-400">
                    <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_6px_#ef4444]" />
                    {criticalCount} Nguy hiểm
                  </span>
                  <span className="text-stone-700">·</span>
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-400">
                    <span className="h-2 w-2 rounded-full bg-amber-500 shadow-[0_0_6px_#f59e0b]" />
                    {warningCount} Cảnh báo
                  </span>
                  <span className="text-stone-700">·</span>
                  <span className="inline-flex items-center gap-1 text-[10px] text-stone-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Live
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Right: tile switcher */}
          <div
            className="flex gap-1 rounded-xl p-1"
            style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(120,113,108,0.25)' }}
          >
            {tileOptions.map(({ key, label, icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setTileStyle(key)}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-bold transition-all duration-200',
                  tileStyle === key
                    ? 'text-amber-100 shadow-md'
                    : 'text-stone-500 hover:text-stone-300',
                )}
                style={
                  tileStyle === key
                    ? { background: 'rgba(217,119,6,0.3)', border: '1px solid rgba(217,119,6,0.5)', boxShadow: '0 0 12px rgba(217,119,6,0.2)' }
                    : undefined
                }
              >
                <span>{icon}</span>
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Main grid ──────────────────────────────────────────────────────── */}
      <div className="grid flex-1 grid-cols-12 gap-4 overflow-hidden">

        {/* Map */}
        <div
          className="col-span-12 overflow-hidden rounded-2xl shadow-xl lg:col-span-8"
          style={{ border: '1px solid rgba(120,113,108,0.3)' }}
        >
          <LandslideMap tileStyle={tileStyle} mapRef={mapRef} />
        </div>

        {/* Sidebar */}
        <div className="col-span-12 flex flex-col gap-3 overflow-y-auto lg:col-span-4">

          {/* Hotspot panel */}
          <div
            className="overflow-hidden rounded-2xl border"
            style={{ background: LS.panelBg, borderColor: LS.panelBorder, boxShadow: '0 8px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03) inset' }}
          >
            {/* Panel header */}
            <div
              className="flex items-center justify-between px-4 py-3"
              style={{ borderBottom: '1px solid rgba(217,119,6,0.14)', background: 'rgba(255,255,255,0.02)' }}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className="grid h-8 w-8 place-items-center rounded-lg text-sm"
                  style={{ background: 'rgba(217,119,6,0.18)', border: '1px solid rgba(217,119,6,0.35)' }}
                >
                  🔥
                </div>
                <div>
                  <div className="text-[13px] font-bold text-stone-100">Điểm Nóng Sạt Lở</div>
                  <div className="text-[9px] text-stone-600">Click để bay đến vị trí trên bản đồ</div>
                </div>
              </div>
              {focusedSpot && (
                <button
                  type="button"
                  onClick={() => setFocusedSpot(null)}
                  className="grid h-6 w-6 place-items-center rounded-lg text-[10px] text-stone-600 transition hover:bg-stone-800 hover:text-stone-300"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Cards */}
            <div className="space-y-1.5 p-3">
              {loadingHotspots ? (
                <div className="flex flex-col items-center justify-center gap-3 py-10">
                  <div className="relative h-8 w-8">
                    <div className="absolute inset-0 rounded-full border-2 border-stone-800" />
                    <div className="absolute inset-0 animate-spin rounded-full border-2 border-amber-600 border-t-transparent" />
                  </div>
                  <span className="text-xs text-stone-600">Đang tải điểm nóng…</span>
                </div>
              ) : hotspots.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-10 text-stone-700">
                  <span className="text-3xl">🏔</span>
                  <span className="text-xs">Không tìm thấy điểm nóng nào.</span>
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

          {/* Model info panel — stone/amber theme */}
          <div
            className="rounded-2xl border p-4 space-y-3"
            style={{ background: 'rgba(28,22,16,0.97)', borderColor: 'rgba(120,113,108,0.25)', boxShadow: '0 4px 20px rgba(0,0,0,0.35)' }}
          >
            <div className="flex items-center gap-2">
              <div
                className="grid h-7 w-7 place-items-center rounded-lg text-sm"
                style={{ background: 'rgba(217,119,6,0.15)', border: '1px solid rgba(217,119,6,0.3)' }}
              >
                📊
              </div>
              <span className="text-[13px] font-bold text-stone-200">Thông tin Mô hình</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {([
                { label: 'Phiên bản', value: 'ML v7 (RF)', icon: '🤖', c: 'rgba(139,92,246,0.15)', tc: '#c4b5fd', bc: 'rgba(139,92,246,0.25)' },
                { label: 'Nodes',     value: '425.180',    icon: '📍', c: 'rgba(59,130,246,0.15)',  tc: '#93c5fd', bc: 'rgba(59,130,246,0.25)' },
                { label: 'Threshold', value: '0.0937',     icon: '⚖️', c: 'rgba(217,119,6,0.15)',  tc: '#fcd34d', bc: 'rgba(217,119,6,0.25)' },
                { label: 'Cập nhật',  value: '0h & 12h',   icon: '🕐', c: 'rgba(16,185,129,0.15)', tc: '#6ee7b7', bc: 'rgba(16,185,129,0.25)' },
              ] as const).map(item => (
                <div
                  key={item.label}
                  className="flex flex-col gap-1 rounded-xl p-2.5"
                  style={{ background: item.c, border: `1px solid ${item.bc}` }}
                >
                  <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: item.tc }}>
                    {item.icon} {item.label}
                  </span>
                  <span className="text-sm font-black text-stone-100">{item.value}</span>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <div
                className="flex items-start gap-2 rounded-xl p-3"
                style={{ background: 'rgba(217,119,6,0.1)', border: '1px solid rgba(217,119,6,0.2)' }}
              >
                <span className="mt-px flex-shrink-0 text-sm">💡</span>
                <p className="text-xs leading-relaxed text-amber-300/80">
                  <strong className="text-amber-300">Mẹo:</strong> Dùng bộ lọc trên bản đồ để chỉ hiển thị vùng NGUY HIỂM hoặc CẢNH BÁO.
                </p>
              </div>
              <div
                className="flex items-start gap-2 rounded-xl p-3"
                style={{ background: 'rgba(120,113,108,0.12)', border: '1px solid rgba(120,113,108,0.2)' }}
              >
                <span className="mt-px flex-shrink-0 text-sm">🖱</span>
                <p className="text-xs leading-relaxed text-stone-400">
                  <strong className="text-stone-300">Click node</strong> trên bản đồ để xem chi tiết: xác suất, lượng mưa, độ ẩm đất.
                </p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
