import { cn } from '../../utils/cn'

export type NewsTickerItem = {
  id: string
  text: string
  severity: 'danger' | 'warning' | 'info'
}

export function NewsTicker({ items, mode = 'flood' }: { items: NewsTickerItem[]; mode?: 'flood' | 'landslide' }) {
  const hasDanger = items.some((i) => i.severity === 'danger')

  const dangerClass = mode === 'landslide' ? 'fps-news-ticker--danger-landslide' : 'fps-news-ticker--danger-flood'

  // Tính toán thời gian chạy động dựa trên số lượng tin (để dài thì chạy chậm lại)
  // Ít nhất 40s, thêm 20s cho mỗi cảnh báo
  const duration = Math.max(40, items.length * 25)

  return (
    <div
      className={cn(
        'fps-news-ticker overflow-hidden rounded-2xl border border-slate-800/50 px-3 py-2',
        hasDanger ? dangerClass : 'fps-news-ticker--base',
      )}
    >
      <div 
        className="fps-news-ticker-track" 
        style={{ animationDuration: `${duration}s` }}
      >
        {[0, 1].map((k) => (
          <div key={k} className="flex items-center gap-10 whitespace-nowrap">
            {items.map((item) => (
              <span
                key={`${item.id}_${k}`}
                className={cn(
                  'text-sm font-semibold',
                  item.severity === 'danger' ? 'text-white' : item.severity === 'warning' ? 'text-white' : 'text-white',
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

