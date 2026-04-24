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

// Demo data dùng khi DB chưa có dữ liệu thực
function buildDemoPoints(): DashboardForecastPoint[] {
  const now = new Date()
  return Array.from({ length: 24 }, (_, i) => {
    const h = new Date(now.getTime() - (23 - i) * 3600 * 1000)
    const hour = h.getHours()
    // Mô phỏng mưa cao vào buổi chiều tối (14-20h)
    const rainBase = hour >= 14 && hour <= 20 ? 4 + Math.random() * 8 : Math.random() * 2
    const prcp = Math.round(rainBase * 10) / 10
    return {
      time: `${String(hour).padStart(2, '0')}:00`,
      prcp,
      flood_depth_cm: Math.round(prcp * 3.5 * 10) / 10,
    }
  })
}

export function RainForecastChart({ points }: { points: DashboardForecastPoint[] }) {
  const isDemo = !points || points.length === 0
  const activePoints = isDemo ? buildDemoPoints() : points
  const labels = activePoints.map((p) => p.time)

  // Dataset chính: lượng mưa (prcp)
  const data = {
    labels,
    datasets: [
      {
        label: 'Rainfall (mm)',
        data: activePoints.map((p) => p.prcp),
        borderColor: '#0284c7',
        backgroundColor: 'rgba(2,132,199,0.15)',
        pointRadius: 2,
        tension: 0.35,
        fill: true,
      },
    ],
  }

  return (
    <div className="relative h-full w-full">
      {isDemo && (
        <span className="absolute right-2 top-1 z-10 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-400 dark:bg-slate-800 dark:text-slate-500">
          demo — chưa có dữ liệu thực
        </span>
      )}
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
                return `Thời gian: ${activePoints[idx]?.time ?? '-'}`
              },
              label: (ctx) => {
                const idx = ctx.dataIndex
                const p = activePoints[idx]
                return `Lượng mưa: ${Number(p?.prcp ?? 0).toFixed(1)} mm`
              },
              afterLabel: (ctx) => {
                const idx = ctx.dataIndex
                const p = activePoints[idx]
                return `Độ ngập: ${Number(p?.flood_depth_cm ?? 0).toFixed(0)} cm`
              },
              footer: (items) => {
                const idx = items?.[0]?.dataIndex ?? 0
                const depth = Number(activePoints[idx]?.flood_depth_cm ?? 0)
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
    </div>
  )
}

