import { useDisasterMode, type DisasterMode } from '../../context/DisasterContext'
import { cn } from '../../utils/cn'
import { useNavigate } from 'react-router-dom'

const TABS: { mode: DisasterMode; icon: string; label: string; region: string }[] = [
  {
    mode: 'flood',
    icon: '🌊',
    label: 'Ngập lụt',
    region: 'Hà Nội',
  },
  {
    mode: 'landslide',
    icon: '⛰️',
    label: 'Sạt lở',
    region: 'Miền Bắc',
  },
]

export function HazardSwitcher() {
  const { mode, setMode } = useDisasterMode()
  const navigate = useNavigate()

  return (
    <div
      className="relative flex items-center gap-1 rounded-2xl p-1"
      style={{
        background: 'rgba(15, 23, 42, 0.6)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
      }}
      role="tablist"
      aria-label="Chọn chế độ thiên tai"
    >
      {TABS.map((tab) => {
        const isActive = mode === tab.mode
        const isFlood = tab.mode === 'flood'

        return (
          <button
            key={tab.mode}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => {
              setMode(tab.mode)
              navigate('/map')
            }}
            className={cn(
              'relative flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-all duration-300',
              isActive ? 'text-white' : 'text-slate-400 hover:text-slate-200',
            )}
            style={
              isActive
                ? {
                    background: isFlood
                      ? 'linear-gradient(135deg, rgba(14,165,233,0.25) 0%, rgba(99,102,241,0.25) 100%)'
                      : 'linear-gradient(135deg, rgba(234,88,12,0.25) 0%, rgba(180,83,9,0.25) 100%)',
                    boxShadow: isFlood
                      ? '0 0 20px rgba(14,165,233,0.3), inset 0 0 10px rgba(14,165,233,0.1)'
                      : '0 0 20px rgba(234,88,12,0.3), inset 0 0 10px rgba(234,88,12,0.1)',
                    border: isFlood
                      ? '1px solid rgba(14,165,233,0.5)'
                      : '1px solid rgba(234,88,12,0.5)',
                  }
                : {}
            }
          >
            {/* Glowing dot indicator */}
            {isActive && (
              <span
                className="absolute -top-1 -right-1 h-2 w-2 rounded-full animate-pulse"
                style={{
                  background: isFlood ? '#0ea5e9' : '#ea580c',
                  boxShadow: isFlood
                    ? '0 0 6px #0ea5e9'
                    : '0 0 6px #ea580c',
                }}
              />
            )}

            <span className="text-base leading-none">{tab.icon}</span>

            <span className="flex flex-col items-start leading-tight">
              <span className="text-xs font-extrabold tracking-wide">{tab.label}</span>
              <span
                className="text-[10px] font-medium"
                style={{
                  color: isActive
                    ? isFlood
                      ? '#7dd3fc'
                      : '#fdba74'
                    : 'rgba(148,163,184,0.7)',
                }}
              >
                {tab.region}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
