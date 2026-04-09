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
import { Line, Bar } from 'react-chartjs-2'
import type { WeatherForecastDay, WeatherForecastPoint } from '../utils/types'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Filler, Tooltip, Legend)

function formatHour(iso: string) {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:00`
}

export function RainChart({
  mode,
  forecast24h,
  forecast3d,
}: {
  mode: '24h' | '3d'
  forecast24h: WeatherForecastPoint[]
  forecast3d: WeatherForecastDay[]
}) {
  if (mode === '24h') {
    const labels = forecast24h.map((p) => formatHour(p.timeIso))
    const data = {
      labels,
      datasets: [
        {
          label: 'Rainfall (mm)',
          data: forecast24h.map((p) => p.rainfallMm),
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
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
        }}
      />
    )
  }

  const labels = forecast3d.map((d) => d.dateIso.slice(5))
  const data = {
    labels,
    datasets: [
      {
        label: 'Rainfall (mm)',
        data: forecast3d.map((d) => d.rainfallMm),
        borderRadius: 10,
        backgroundColor: ['#10b981', '#f59e0b', '#fb7185'],
      },
    ],
  }

  return (
    <Bar
      data={data}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      }}
    />
  )
}

