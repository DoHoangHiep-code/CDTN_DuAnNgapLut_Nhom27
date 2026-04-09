import { cn } from '../utils/cn'

export type NewsTickerItem = {
  id: string
  text: string
  severity: 'danger' | 'warning' | 'info'
}

export function NewsTicker({ items }: { items: NewsTickerItem[] }) {
  const hasDanger = items.some((i) => i.severity === 'danger')

  return (
    <div
      className={cn(
        'fps-news-ticker overflow-hidden rounded-2xl border border-slate-800/50 px-3 py-2',
        hasDanger ? 'fps-news-ticker--danger' : 'fps-news-ticker--base',
      )}
    >
      <div className="fps-news-ticker-track">
        {[0, 1].map((k) => (
          <div key={k} className="flex items-center gap-10 whitespace-nowrap">
            {items.map((item) => (
              <span
                key={`${item.id}_${k}`}
                className={cn(
                  'text-sm font-semibold',
                  item.severity === 'danger' ? 'text-rose-100' : item.severity === 'warning' ? 'text-amber-100' : 'text-sky-100',
                )}
              >
                {item.text}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

