import { useState } from 'react'
import { Droplets, Thermometer, Wind, CloudRain, RefreshCcw, ExternalLink } from 'lucide-react'
import { Card, CardHeader, CardMeta, CardTitle } from '../components/Card'
import { Spinner } from '../components/Spinner'
import { ErrorState } from '../components/ErrorState'
import { RiskBadge } from '../components/Badge'
import { Button } from '../components/Button'
import { RainForecastChart } from '../components/RainForecastChart'
import { TempHumidityChart } from '../components/TempHumidityChart'
import { RiskTrendChart } from '../components/RiskTrendChart'
import { useAsync } from '../hooks/useAsync'
import { getDashboard } from '../services/api'
import { useTranslation } from 'react-i18next'

export function DashboardPage() {
  const { t } = useTranslation()
  const dashboard = useAsync(getDashboard, [])
  const [mode, setMode] = useState<'24h' | '3d'>('24h')

  if (dashboard.loading) return <Spinner label="Loading dashboard…" />
  if (dashboard.error) return <ErrorState error={dashboard.error} onRetry={dashboard.reload} />
  if (!dashboard.data) return null

  const cw = dashboard.data.currentWeather
  const riskSummary = dashboard.data.riskSummary
  const forecast24h = dashboard.data.forecast24h ?? []
  const tempHumidity24h = dashboard.data.tempHumidity24h ?? []
  const riskTrend7d = dashboard.data.riskTrend7d ?? []

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
            {t('dashboard.title')}
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">{t('dashboard.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<RefreshCcw className="h-4 w-4" />}
            onClick={() => dashboard.reload()}
          >
            {t('dashboard.refresh')}
          </Button>
          <a
            href="https://app.powerbi.com/view?r=eyJrIjoiODk5Mjk3ODQtOTUzOS00NTY3LTk3MTYtMGFlYjY1N2E4OWE1IiwidCI6IjVhYWYwYTA1LTkzMGYtNGEzZS04Njk1LWI2OTE1OGY1NWZiNiIsImMiOjEwfQ%3D%3D"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500 bg-indigo-50 px-3 py-1.5 text-sm font-semibold text-indigo-700 shadow-sm transition hover:bg-indigo-100 active:scale-95 dark:border-indigo-400 dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/50"
          >
            <ExternalLink className="h-4 w-4" />
            Mở báo cáo Power BI
          </a>
        </div>
      </div>

      {/* ── Thời tiết hiện tại (3 cards) ── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t('dashboard.temperature')}</CardTitle>
              <CardMeta>CockroachDB · giờ hiện tại</CardMeta>
            </div>
            <Thermometer className="fps-3d-icon h-9 w-9 text-orange-500 drop-shadow-sm dark:text-orange-400" />
          </CardHeader>
          <div className="text-3xl font-extrabold text-orange-600 dark:text-orange-400">
            {cw.temperature.toFixed(1)}°C
          </div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Trung bình tất cả trạm đo trong giờ này
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t('dashboard.humidity')}</CardTitle>
              <CardMeta>CockroachDB · giờ hiện tại</CardMeta>
            </div>
            <Droplets className="fps-3d-icon h-9 w-9 text-sky-600 drop-shadow-sm dark:text-sky-400" />
          </CardHeader>
          <div className="text-3xl font-extrabold text-sky-600 dark:text-sky-400">
            {cw.humidity.toFixed(0)}%
          </div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('dashboard.comfortHint')}</div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t('dashboard.wind')}</CardTitle>
              <CardMeta>CockroachDB · giờ hiện tại</CardMeta>
            </div>
            <Wind className="fps-3d-icon h-9 w-9 text-cyan-600 drop-shadow-sm dark:text-cyan-400" />
          </CardHeader>
          <div className="text-3xl font-extrabold text-cyan-700 dark:text-cyan-300">
            {cw.windSpeed.toFixed(1)} m/s
          </div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('dashboard.windHint')}</div>
        </Card>
      </div>

      {/* ── Biểu đồ hàng 2: Mưa + Ngập | Nguy cơ ngập hiện tại ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Biểu đồ mưa + độ ngập 24h */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>{t('dashboard.rainForecast')}</CardTitle>
              <CardMeta>{mode === '24h' ? 'Lượng mưa & độ ngập · 24h qua (CockroachDB)' : '3 giờ gần nhất'}</CardMeta>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant={mode === '24h' ? 'secondary' : 'ghost'} onClick={() => setMode('24h')}>
                {t('dashboard.mode24h')}
              </Button>
              <Button size="sm" variant={mode === '3d' ? 'secondary' : 'ghost'} onClick={() => setMode('3d')}>
                {t('dashboard.mode3d')}
              </Button>
            </div>
          </CardHeader>
          <div className="h-56 min-h-[14rem]">
            <RainForecastChart
              points={mode === '24h' ? forecast24h : forecast24h.slice(-3)}
            />
          </div>
        </Card>

        {/* Tổng hợp nguy cơ ngập từ flood_predictions */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t('dashboard.floodRiskSummary')}</CardTitle>
              <CardMeta>flood_predictions · 2h gần nhất</CardMeta>
            </div>
            <CloudRain className="fps-3d-icon h-9 w-9 text-indigo-600 drop-shadow-sm dark:text-indigo-400" />
          </CardHeader>
          <div className="flex items-center gap-3">
            <RiskBadge level={riskSummary.overall} />
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {t('dashboard.overall')}: {t(`risk.${riskSummary.overall}`)}
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {(['safe', 'medium', 'high', 'severe'] as const).map((level) => {
              const count = riskSummary[level] ?? 0
              const total = (riskSummary.safe ?? 0) + (riskSummary.medium ?? 0) + (riskSummary.high ?? 0) + (riskSummary.severe ?? 0)
              const pct = total > 0 ? Math.round((count / total) * 100) : 0
              const barColor = { safe: 'bg-green-500', medium: 'bg-amber-400', high: 'bg-orange-500', severe: 'bg-rose-600' }[level]
              const label = { safe: 'An toàn', medium: 'Trung bình', high: 'Cao', severe: 'Nghiêm trọng' }[level]
              return (
                <div key={level} className="space-y-0.5">
                  <div className="flex justify-between text-xs text-slate-600 dark:text-slate-300">
                    <span>{label}</span>
                    <span className="font-mono">{count.toLocaleString()} ({pct}%)</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      </div>

      {/* ── Biểu đồ hàng 3: Nhiệt độ/Độ ẩm 24h | Risk trend 7 ngày ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Nhiệt độ & Độ ẩm</CardTitle>
              <CardMeta>24h qua · weather_measurements (CockroachDB)</CardMeta>
            </div>
          </CardHeader>
          <div className="h-52 min-h-[13rem]">
            <TempHumidityChart points={tempHumidity24h} />
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Xu hướng nguy cơ ngập</CardTitle>
              <CardMeta>7 ngày qua · flood_predictions (CockroachDB)</CardMeta>
            </div>
          </CardHeader>
          <div className="h-52 min-h-[13rem]">
            <RiskTrendChart days={riskTrend7d} />
          </div>
        </Card>
      </div>
    </div>
  )
}
