import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import type { DashboardTempHumPoint } from '../utils/types'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend)

export function TempHumidityChart({ points }: { points: DashboardTempHumPoint[] }) {
  const hasData = points && points.length > 0
  const labels = hasData ? points.map((p) => p.time) : []

  const data = {
    labels,
    datasets: [
      {
        label: 'Nhiệt độ (°C)',
        data: hasData ? points.map((p) => p.temp) : [],
        borderColor: '#f97316',
        backgroundColor: 'rgba(249,115,22,0.08)',
        pointRadius: 2,
        tension: 0.35,
        fill: false,
        yAxisID: 'yTemp',
      },
      {
        label: 'Độ ẩm (%)',
        data: hasData ? points.map((p) => p.rhum) : [],
        borderColor: '#0ea5e9',
        backgroundColor: 'rgba(14,165,233,0.1)',
        pointRadius: 2,
        tension: 0.35,
        fill: true,
        yAxisID: 'yRhum',
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
      <Line
        data={data}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: true, position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
            tooltip: {
              callbacks: {
                label: (ctx: any) => {
                  if (ctx.dataset.label?.includes('Nhiệt')) return `Nhiệt độ: ${Number(ctx.raw).toFixed(1)}°C`
                  return `Độ ẩm: ${Number(ctx.raw).toFixed(0)}%`
                },
              },
              backgroundColor: 'rgba(15,23,42,0.92)',
              titleColor: '#e2e8f0',
              bodyColor: '#e2e8f0',
              padding: 10,
              cornerRadius: 8,
            },
          },
          scales: {
            yTemp: {
              type: 'linear',
              position: 'left',
              title: { display: true, text: '°C', font: { size: 10 } },
              ticks: { precision: 1, font: { size: 10 } },
              grid: { color: 'rgba(148,163,184,0.15)' },
            },
            yRhum: {
              type: 'linear',
              position: 'right',
              min: 0,
              max: 100,
              title: { display: true, text: '%', font: { size: 10 } },
              ticks: { precision: 0, font: { size: 10 } },
              grid: { drawOnChartArea: false },
            },
          },
        }}
      />
    </div>
  )
}
