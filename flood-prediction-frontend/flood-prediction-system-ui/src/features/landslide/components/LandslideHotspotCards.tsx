import { cn } from '../../../utils/cn'

// ── Mock data ──────────────────────────────────────────────────────────────
const LANDSLIDE_HOTSPOTS = [
  {
    id: 'mu-cang-chai',
    name: 'Mù Cang Chải',
    province: 'Yên Bái',
    risk: 'critical' as const,        // RẤT CAO
    soilMoisture: 88,                  // %
    rain7d: 185,                       // mm
    slope: 35,                         // degrees
    ndvi: 0.28,                        // Thưa thớt
    lat: 21.8036,
    lng: 104.0828,
  },
  {
    id: 'hoang-su-phi',
    name: 'Hoàng Su Phì',
    province: 'Hà Giang',
    risk: 'warning' as const,         // CẢNH BÁO
    soilMoisture: 76,
    rain7d: 142,
    slope: 28,
    ndvi: 0.41,                       // Trung bình
    lat: 22.7333,
    lng: 104.5333,
  },
  {
    id: 'muong-te',
    name: 'Mường Tè',
    province: 'Lai Châu',
    risk: 'critical' as const,
    soilMoisture: 82,
    rain7d: 163,
    slope: 40,
    ndvi: 0.35,
    lat: 22.3667,
    lng: 102.8167,
  },
  {
    id: 'sa-pa',
    name: 'Sa Pa',
    province: 'Lào Cai',
    risk: 'warning' as const,
    soilMoisture: 71,
    rain7d: 118,
    slope: 32,
    ndvi: 0.52,                       // Khá dày
    lat: 22.3363,
    lng: 103.8438,
  },
]

function RiskBadge({ risk }: { risk: 'critical' | 'warning' }) {
  return (
    <span
      className={cn(
        'rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest shadow-sm',
        risk === 'critical'
          ? 'bg-red-500/20 text-red-300 ring-1 ring-red-500/40'
          : 'bg-orange-500/20 text-orange-300 ring-1 ring-orange-500/40',
      )}
    >
      {risk === 'critical' ? '🔴 Rất Cao' : '🟠 Cảnh Báo'}
    </span>
  )
}

function MoistureBar({ value }: { value: number }) {
  const color = value >= 85 ? '#ef4444' : value >= 70 ? '#f97316' : '#eab308'
  return (
    <div className="mt-2 h-1.5 w-full rounded-full bg-slate-700/60">
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${value}%`, background: color, boxShadow: `0 0 8px ${color}60` }}
      />
    </div>
  )
}

function NdviLabel({ ndvi }: { ndvi: number }) {
  if (ndvi < 0.3) return <span className="text-red-400">Rất thưa ({ndvi.toFixed(2)})</span>
  if (ndvi < 0.45) return <span className="text-orange-400">Thưa ({ndvi.toFixed(2)})</span>
  if (ndvi < 0.6) return <span className="text-yellow-400">Trung bình ({ndvi.toFixed(2)})</span>
  return <span className="text-green-400">Dày ({ndvi.toFixed(2)})</span>
}

export function LandslideHotspotCards() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {LANDSLIDE_HOTSPOTS.map((spot) => {
        const isCritical = spot.risk === 'critical'

        return (
          <div
            key={spot.id}
            className="relative overflow-hidden rounded-2xl border transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
            style={{
              background: isCritical
                ? 'linear-gradient(145deg, rgba(30,10,10,0.95), rgba(40,15,10,0.9))'
                : 'linear-gradient(145deg, rgba(20,15,10,0.95), rgba(30,20,10,0.9))',
              borderColor: isCritical
                ? 'rgba(239,68,68,0.3)'
                : 'rgba(249,115,22,0.3)',
              boxShadow: isCritical
                ? '0 0 30px rgba(239,68,68,0.1), inset 0 1px 0 rgba(255,255,255,0.05)'
                : '0 0 30px rgba(249,115,22,0.1), inset 0 1px 0 rgba(255,255,255,0.05)',
            }}
          >
            {/* Subtle gradient overlay top-right */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background: isCritical
                  ? 'radial-gradient(ellipse at 100% 0%, rgba(239,68,68,0.08) 0%, transparent 60%)'
                  : 'radial-gradient(ellipse at 100% 0%, rgba(249,115,22,0.08) 0%, transparent 60%)',
              }}
            />

            <div className="relative p-4">
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-extrabold text-white">{spot.name}</div>
                  <div className="text-[11px] text-slate-400">{spot.province}</div>
                </div>
                <RiskBadge risk={spot.risk} />
              </div>

              {/* Mountain Icon + soil moisture */}
              <div className="mt-4 flex flex-col items-center text-center">
                <div
                  className="mb-2 grid h-14 w-14 place-items-center rounded-2xl"
                  style={{
                    background: isCritical
                      ? 'rgba(239,68,68,0.15)'
                      : 'rgba(249,115,22,0.15)',
                    border: `1px solid ${isCritical ? 'rgba(239,68,68,0.3)' : 'rgba(249,115,22,0.3)'}`,
                  }}
                >
                  {/* Landslide SVG icon */}
                  <svg viewBox="0 0 48 48" className="h-8 w-8" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M4 38 L16 14 L28 28 L36 18 L44 38 Z" fill={isCritical ? '#ef444440' : '#f9731640'} stroke={isCritical ? '#ef4444' : '#f97316'} strokeWidth="2" strokeLinejoin="round" />
                    <path d="M20 38 Q24 30 30 34 Q34 28 40 38" stroke={isCritical ? '#ef4444cc' : '#f97316cc'} strokeWidth="1.5" fill="none" strokeLinecap="round" />
                    {/* Rocks / debris */}
                    <circle cx="22" cy="36" r="2" fill={isCritical ? '#ef4444' : '#f97316'} opacity="0.7" />
                    <circle cx="30" cy="37" r="1.5" fill={isCritical ? '#ef4444' : '#f97316'} opacity="0.5" />
                    <circle cx="26" cy="38.5" r="1" fill={isCritical ? '#ef4444' : '#f97316'} opacity="0.4" />
                    {/* Rain drops */}
                    <line x1="10" y1="6" x2="10" y2="10" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" />
                    <line x1="16" y1="4" x2="16" y2="8" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" />
                    <line x1="22" y1="6" x2="22" y2="10" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </div>

                {/* Soil moisture — main metric */}
                <div
                  className="text-3xl font-black tabular-nums"
                  style={{
                    color: spot.soilMoisture >= 85 ? '#ef4444' : '#f97316',
                    textShadow: `0 0 20px ${spot.soilMoisture >= 85 ? '#ef444480' : '#f9731680'}`,
                  }}
                >
                  {spot.soilMoisture}%
                </div>
                <div className="mt-0.5 text-[11px] font-semibold text-slate-400">Độ ẩm đất</div>
                <MoistureBar value={spot.soilMoisture} />
              </div>

              {/* 3 Sub-metrics */}
              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-700/50 pt-3">
                {/* Rain 7 days */}
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-[10px] text-slate-500">🌧 Mưa 7D</span>
                  <span className="text-xs font-bold text-blue-400">{spot.rain7d}<span className="text-[9px] font-normal text-slate-500 ml-0.5">mm</span></span>
                </div>

                {/* Slope */}
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-[10px] text-slate-500">📐 Độ dốc</span>
                  <span className="text-xs font-bold text-amber-400">{spot.slope}°</span>
                </div>

                {/* NDVI */}
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-[10px] text-slate-500">🌿 NDVI</span>
                  <span className="text-xs font-bold"><NdviLabel ndvi={spot.ndvi} /></span>
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export { LANDSLIDE_HOTSPOTS }
