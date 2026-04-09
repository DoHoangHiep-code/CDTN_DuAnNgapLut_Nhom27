import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
  type TooltipItem,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import type { DashboardForecastPoint } from '../utils/types'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend)

function probFromDepth(depthCm: number) {
  // Quy ước theo yêu cầu: > 10cm => CAO, ngược lại THẤP
  return depthCm > 10
    ? { label: 'Khả năng ngập: CAO', color: '#e11d48' }
    : { label: 'Khả năng ngập: THẤP', color: '#16a34a' }
}

export function RainForecastChart({ points }: { points: DashboardForecastPoint[] }) {
  const labels = points.map((p) => p.time)

  // Dataset chính: lượng mưa (prcp)
  const data = {
    labels,
    datasets: [
      {
        label: 'Rainfall (mm)',
        data: points.map((p) => p.prcp),
        borderColor: '#0284c7',
        backgroundColor: 'rgba(2,132,199,0.15)',
        pointRadius: 2,
        tension: 0.35,
        fill: true,
      },
    ],
  }

  return (
    <Line
      data={data}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          // Tooltip tuỳ biến để hiển thị đủ 3 field: time, prcp, flood_depth_cm + xác suất ngập
          tooltip: {
            callbacks: {
              title: (items: TooltipItem<'line'>[]) => {
                const idx = items?.[0]?.dataIndex ?? 0
                return `Thời gian: ${points[idx]?.time ?? '-'}`
              },
              label: (ctx) => {
                const idx = ctx.dataIndex
                const p = points[idx]
                return `Lượng mưa: ${Number(p?.prcp ?? 0).toFixed(1)} mm`
              },
              afterLabel: (ctx) => {
                const idx = ctx.dataIndex
                const p = points[idx]
                return `Độ ngập: ${Number(p?.flood_depth_cm ?? 0).toFixed(0)} cm`
              },
              footer: (items) => {
                const idx = items?.[0]?.dataIndex ?? 0
                const depth = Number(points[idx]?.flood_depth_cm ?? 0)
                return probFromDepth(depth).label
              },
            },
            // Style tooltip để giống “box” hiện đại
            backgroundColor: 'rgba(15, 23, 42, 0.92)',
            titleColor: '#e2e8f0',
            bodyColor: '#e2e8f0',
            footerColor: '#e2e8f0',
            padding: 12,
            cornerRadius: 10,
            displayColors: false,
          },
        },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      }}
    />
  )
}

