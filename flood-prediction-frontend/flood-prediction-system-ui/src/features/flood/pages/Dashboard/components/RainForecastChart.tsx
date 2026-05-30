import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts'
import type { DashboardForecastPoint } from '../../../../../utils/types'
import { ChartWrapper } from './ChartWrapper'

export function RainForecastChart({ points }: { points: DashboardForecastPoint[] }) {
  const hasData = points && points.length > 0
  let currentStr = ''
  if (hasData) {
    const now = new Date()
    let minDiff = Infinity
    points.forEach(p => {
      if (!p.time) return
      const parts = p.time.split(' ')
      if (parts.length !== 2) return
      const [day, month] = parts[0].split('/')
      const [hour, minute] = parts[1].split(':')
      const pDate = new Date(now.getFullYear(), Number(month) - 1, Number(day), Number(hour), Number(minute))
      const diff = Math.abs(pDate.getTime() - now.getTime())
      if (diff < minDiff) {
        minDiff = diff
        currentStr = p.time
      }
    })
  }

  return (
    <ChartWrapper className="relative h-full w-full">
      {({ width, height }) => (
        <>
          {!hasData && (
            <span className="absolute right-2 top-1 z-10 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-400 dark:bg-slate-800 dark:text-slate-500">
              chưa có dữ liệu
            </span>
          )}
          <ComposedChart
            width={width}
            height={height}
            data={hasData ? points : []}
            margin={{ top: 25, right: 10, left: -20, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.2} vertical={false} />
            <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} domain={[0, 'auto']} />
            <Tooltip
              contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#f8fafc' }}
              itemStyle={{ fontSize: '13px', color: '#e2e8f0' }}
              labelStyle={{ color: '#94a3b8', marginBottom: '4px' }}
              formatter={(value, name) => {
                const v = Number(value ?? 0)
                if (name === 'Lượng mưa (mm)') return [`${v.toFixed(1)} mm`, name]
                return [`${v.toFixed(1)} cm`, name]
              }}
            />
            <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
            <ReferenceLine x={currentStr} stroke="#ef4444" strokeDasharray="3 3" label={{ position: 'top', value: 'Hiện tại', fill: '#ef4444', fontSize: 10 }} />
            <Bar yAxisId="left" dataKey="prcp" name="Lượng mưa (mm)" fill="#0ea5e9" radius={[4, 4, 0, 0]} barSize={20} />
            <Line yAxisId="right" type="monotone" dataKey="flood_depth_cm" name="Độ ngập (cm)" stroke="#e11d48" strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
          </ComposedChart>
        </>
      )}
    </ChartWrapper>
  )
}
