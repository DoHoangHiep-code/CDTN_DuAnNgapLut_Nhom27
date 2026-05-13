import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import type { DashboardRiskTrendDay } from '../utils/types'

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

  const data = {
    labels,
    datasets: [
      {
        label: 'An toàn',
        data: hasData ? days.map((d) => d.safe) : [],
        backgroundColor: RISK_COLORS.safe.bg,
        borderColor: RISK_COLORS.safe.border,
        borderWidth: 1,
        borderRadius: 3,
        stack: 'risk',
      },
      {
        label: 'Trung bình',
        data: hasData ? days.map((d) => d.medium) : [],
        backgroundColor: RISK_COLORS.medium.bg,
        borderColor: RISK_COLORS.medium.border,
        borderWidth: 1,
        borderRadius: 3,
        stack: 'risk',
      },
      {
        label: 'Cao',
        data: hasData ? days.map((d) => d.high) : [],
        backgroundColor: RISK_COLORS.high.bg,
        borderColor: RISK_COLORS.high.border,
        borderWidth: 1,
        borderRadius: 3,
        stack: 'risk',
      },
      {
        label: 'Nghiêm trọng',
        data: hasData ? days.map((d) => d.severe) : [],
        backgroundColor: RISK_COLORS.severe.bg,
        borderColor: RISK_COLORS.severe.border,
        borderWidth: 1,
        borderRadius: 3,
        stack: 'risk',
      },
    ],
  }

  return (
    <div className="relative h-full w-full">
      {!hasData && (
        <span className="absolute right-2 top-1 z-10 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-400 dark:bg-slate-800 dark:text-slate-500">
          chưa có dữ liệu
        </span>
      )}
      <Bar
        data={data}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: true, position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
            tooltip: {
              callbacks: {
                title: (items: any[]) => `Ngày: ${items[0]?.label ?? '-'}`,
                label: (ctx: any) => `${ctx.dataset.label}: ${Number(ctx.raw ?? 0).toLocaleString()} điểm`,
              },
              backgroundColor: 'rgba(15,23,42,0.92)',
              titleColor: '#e2e8f0',
              bodyColor: '#e2e8f0',
              padding: 10,
              cornerRadius: 8,
            },
          },
          scales: {
            x: { stacked: true, ticks: { font: { size: 10 } } },
            y: {
              stacked: true,
              beginAtZero: true,
              ticks: { font: { size: 10 } },
              grid: { color: 'rgba(148,163,184,0.15)' },
            },
          },
        }}
      />
    </div>
  )
}
