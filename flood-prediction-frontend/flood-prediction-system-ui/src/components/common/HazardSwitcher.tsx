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
      className="relative flex items-center gap-1 rounded-2xl p-1 bg-slate-100/80 dark:bg-slate-900/60 backdrop-blur-md border border-slate-200/80 dark:border-white/10 shadow-inner dark:shadow-[0_4px_24px_rgba(0,0,0,0.3)]"
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
              isActive
                ? isFlood
                  ? 'bg-white text-sky-700 shadow-[0_4px_12px_rgba(14,165,233,0.15)] border border-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/30 dark:shadow-[0_0_20px_rgba(14,165,233,0.2)]'
                  : 'bg-white text-amber-700 shadow-[0_4px_12px_rgba(245,158,11,0.15)] border border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30 dark:shadow-[0_0_20px_rgba(245,158,11,0.2)]'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 border border-transparent',
            )}
          >
            {/* Glowing dot indicator */}
            {isActive && (
              <span
                className={cn(
                  'absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full animate-pulse border-2 border-white dark:border-slate-800',
                  isFlood
                    ? 'bg-sky-500 shadow-[0_0_6px_rgba(14,165,233,0.8)]'
                    : 'bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.8)]'
                )}
              />
            )}

            <span className="text-base leading-none">{tab.icon}</span>

            <span className="flex flex-col items-start leading-tight">
              <span className="text-xs font-extrabold tracking-wide">{tab.label}</span>
              <span
                className={cn(
                  'text-[10px] font-medium',
                  isActive
                    ? isFlood
                      ? 'text-sky-500/80 dark:text-sky-400/80'
                      : 'text-amber-500/80 dark:text-amber-400/80'
                    : 'text-slate-400 dark:text-slate-500',
                )}
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
