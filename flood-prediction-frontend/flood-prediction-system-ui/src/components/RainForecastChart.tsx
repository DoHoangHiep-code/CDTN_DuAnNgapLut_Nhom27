import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js'
import { Chart } from 'react-chartjs-2'
import type { DashboardForecastPoint } from '../utils/types'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Filler, Tooltip, Legend)

export function RainForecastChart({ points }: { points: DashboardForecastPoint[] }) {
  const hasData = points && points.length > 0

  const labels = hasData ? points.map((p) => p.time) : []
  const prcpData = hasData ? points.map((p) => p.prcp) : []
  const depthData = hasData ? points.map((p) => p.flood_depth_cm) : []

  const data = {
    labels,
    datasets: [
      {
        type: 'bar' as const,
        label: 'Lượng mưa (mm)',
        data: prcpData,
        backgroundColor: 'rgba(2,132,199,0.55)',
        borderColor: '#0284c7',
        borderWidth: 1,
        borderRadius: 3,
        yAxisID: 'yRain',
        order: 2,
      },
      {
        type: 'line' as const,
        label: 'Độ ngập (cm)',
        data: depthData,
        borderColor: '#e11d48',
        backgroundColor: 'rgba(225,29,72,0.08)',
        pointRadius: 2,
        pointHoverRadius: 5,
        tension: 0.35,
        fill: true,
        yAxisID: 'yDepth',
        order: 1,
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
      <Chart
        type="bar"
        data={data}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              display: true,
              position: 'top',
              labels: { boxWidth: 12, font: { size: 11 } },
            },
            tooltip: {
              callbacks: {
                title: (items: any[]) => `Thời gian: ${items[0]?.label ?? '-'}`,
                label: (ctx) => {
                  if (ctx.dataset.label === 'Lượng mưa (mm)') return `Mưa: ${Number(ctx.raw ?? 0).toFixed(1)} mm`
                  return `Ngập: ${Number(ctx.raw ?? 0).toFixed(0)} cm`
                },
              },
              backgroundColor: 'rgba(15,23,42,0.92)',
              titleColor: '#e2e8f0',
              bodyColor: '#e2e8f0',
              padding: 10,
              cornerRadius: 8,
              displayColors: true,
            },
          },
          scales: {
            yRain: {
              type: 'linear',
              position: 'left',
              beginAtZero: true,
              title: { display: true, text: 'Mưa (mm)', font: { size: 10 } },
              ticks: { precision: 1, font: { size: 10 } },
              grid: { color: 'rgba(148,163,184,0.15)' },
            },
            yDepth: {
              type: 'linear',
              position: 'right',
              beginAtZero: true,
              title: { display: true, text: 'Ngập (cm)', font: { size: 10 } },
              ticks: { precision: 0, font: { size: 10 } },
              grid: { drawOnChartArea: false },
            },
          },
        }}
      />
    </div>
  )
}
