import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';
import type { DashboardRiskTrendDay } from '../../../../../utils/types';

const RISK_COLORS = {
  safe: '#16a34a', // green-600
  medium: '#f59e0b', // amber-500
  high: '#f97316', // orange-500
  severe: '#e11d48', // rose-600
};

export function RiskTrendChart({ days }: { days: DashboardRiskTrendDay[] }) {
  const hasData = days && days.length > 0;

  const chartData = hasData ? days.map(d => {
    let value = 0;
    let color = RISK_COLORS.safe;
    let levelStr = 'safe';
    
    if ((d.severe ?? 0) > 0) { value = 3; color = RISK_COLORS.severe; levelStr = 'severe'; }
    else if ((d.high ?? 0) > 0) { value = 2; color = RISK_COLORS.high; levelStr = 'high'; }
    else if ((d.medium ?? 0) > 0) { value = 1; color = RISK_COLORS.medium; levelStr = 'medium'; }

    return {
      date: d.date,
      value,
      color,
      levelStr
    };
  }) : [];

  const allSafe = chartData.length > 0 && chartData.every(v => v.value === 0);
  const riskLabels = ['An toàn', 'Trung bình', 'Cao', 'Nghiêm trọng'];

  return (
    <div className="relative h-full w-full">
      {!hasData && (
        <span className="absolute right-2 top-1 z-10 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-400 dark:bg-slate-800 dark:text-slate-500">
          chưa có dữ liệu
        </span>
      )}
      {hasData && allSafe && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-white/50 dark:bg-slate-900/50 backdrop-blur-[2px] rounded-xl">
          <span className="text-2xl">✅</span>
          <span className="text-sm font-semibold text-green-600 dark:text-green-400">Toàn bộ khu vực ở mức An toàn</span>
          <span className="text-xs text-slate-400">Không có cảnh báo ngập lụt</span>
        </div>
      )}
      <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
        <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.2} vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
          <YAxis 
            domain={[0, 3]} 
            tick={{ fontSize: 11, fill: '#64748b' }} 
            tickFormatter={(val) => riskLabels[val] || ''}
            axisLine={false} 
            tickLine={false} 
            tickCount={4}
          />
          <Tooltip 
            contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#f8fafc' }}
            itemStyle={{ fontSize: '13px', color: '#e2e8f0' }}
            labelStyle={{ color: '#94a3b8', marginBottom: '4px' }}
            formatter={(value: number) => {
              return [riskLabels[value], 'Mức nguy cơ ngập'];
            }}
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={30}>
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
