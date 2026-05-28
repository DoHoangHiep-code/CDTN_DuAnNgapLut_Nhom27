import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import type { DashboardTempHumPoint } from '../../../../../utils/types'
import { ChartWrapper } from './ChartWrapper'

export function TempHumidityChart({ points }: { points: DashboardTempHumPoint[] }) {
  const hasData = points && points.length > 0

  return (
    <ChartWrapper className="relative h-full w-full">
      {({ width, height }) => (
        <>
          {!hasData && (
            <span className="absolute right-2 top-1 z-10 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-400 dark:bg-slate-800 dark:text-slate-500">
              chưa có dữ liệu
            </span>
          )}
          <LineChart
            width={width}
            height={height}
            data={hasData ? points : []}
            margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.2} vertical={false} />
            <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#f8fafc' }}
              itemStyle={{ fontSize: '13px', color: '#e2e8f0' }}
              labelStyle={{ color: '#94a3b8', marginBottom: '4px' }}
              formatter={(value, name) => {
                const v = Number(value ?? 0)
                if (name === 'Nhiệt độ (°C)') return [`${v.toFixed(1)} °C`, name]
                return [`${v.toFixed(0)} %`, name]
              }}
            />
            <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
            <Line yAxisId="left" type="monotone" dataKey="temp" name="Nhiệt độ (°C)" stroke="#f97316" strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
            <Line yAxisId="right" type="monotone" dataKey="rhum" name="Độ ẩm (%)" stroke="#0ea5e9" strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
          </LineChart>
        </>
      )}
    </ChartWrapper>
  )
}
