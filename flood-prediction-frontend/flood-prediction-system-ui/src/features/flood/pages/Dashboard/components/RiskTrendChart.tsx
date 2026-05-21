import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import type { DashboardRiskTrendDay } from '../../../../../utils/types'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const RISK_COLORS = {
  safe:   { bg: 'rgba(22,163,74,0.75)',  border: '#16a34a' },
  medium: { bg: 'rgba(245,158,11,0.75)', border: '#f59e0b' },
  high:   { bg: 'rgba(249,115,22,0.75)', border: '#f97316' },
  severe: { bg: 'rgba(225,29,72,0.75)',  border: '#e11d48' },
}

export function RiskTrendChart({ days }: { days: DashboardRiskTrendDay[] }) {
  const hasData = days && days.length > 0
  const labels = hasData ? days.map((d) => d.date) : []

  // Tìm mức độ nguy cơ cao nhất cho mỗi khoảng thời gian
  // safe -> 0, medium -> 1, high -> 2, severe -> 3
  const chartData = hasData ? days.map(d => {
    if ((d.severe ?? 0) > 0) return 3;
    if ((d.high ?? 0) > 0) return 2;
    if ((d.medium ?? 0) > 0) return 1;
    return 0; // safe
  }) : []

  // Kiểm tra xem tất cả đều an toàn không
  const allSafe = chartData.length > 0 && chartData.every(v => v === 0)

  // Đổi màu thanh bar tùy theo giá trị
  const backgroundColors = chartData.map(val => {
    if (val === 3) return RISK_COLORS.severe.bg;
    if (val === 2) return RISK_COLORS.high.bg;
    if (val === 1) return RISK_COLORS.medium.bg;
    return RISK_COLORS.safe.bg;
  })
  const borderColors = chartData.map(val => {
    if (val === 3) return RISK_COLORS.severe.border;
    if (val === 2) return RISK_COLORS.high.border;
    if (val === 1) return RISK_COLORS.medium.border;
    return RISK_COLORS.safe.border;
  })

  const riskLabels = ['An toàn', 'Trung bình', 'Cao', 'Nghiêm trọng'];

  const data = {
    labels,
    datasets: [
      {
        label: 'Mức nguy cơ ngập',
        data: chartData,
        backgroundColor: backgroundColors,
        borderColor: borderColors,
        borderWidth: 1,
        borderRadius: 3,
      }
    ],
  }

  return (
    <div className="relative h-full w-full">
      {!hasData && (
        <span className="absolute right-2 top-1 z-10 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-400 dark:bg-slate-800 dark:text-slate-500">
          chưa có dữ liệu
        </span>
      )}
      {hasData && allSafe && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
          <span className="text-2xl">✅</span>
          <span className="text-sm font-semibold text-green-600 dark:text-green-400">Toàn bộ khu vực ở mức An toàn</span>
          <span className="text-xs text-slate-400">Không có cảnh báo ngập lụt</span>
        </div>
      )}
      <Bar
        data={data}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: (items: any[]) => `Ngày: ${items[0]?.label ?? '-'}`,
                label: (ctx: any) => `Nguy cơ: ${riskLabels[ctx.raw]}`,
              },
              backgroundColor: 'rgba(15,23,42,0.92)',
              titleColor: '#e2e8f0',
              bodyColor: '#e2e8f0',
              padding: 10,
              cornerRadius: 8,
            },
          },
          scales: {
            x: { ticks: { font: { size: 10 } } },
            y: {
              min: 0,
              max: 3,
              ticks: { 
                stepSize: 1,
                font: { size: 10 },
                callback: function(value) {
                  return riskLabels[Number(value)] || value;
                }
              },
              grid: { color: 'rgba(148,163,184,0.15)' },
            },
          },
        }}
      />
    </div>
  )
}
