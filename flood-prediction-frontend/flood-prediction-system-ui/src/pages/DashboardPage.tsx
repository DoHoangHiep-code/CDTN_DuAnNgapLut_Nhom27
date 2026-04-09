import { useMemo, useState } from 'react'
import { Droplets, Thermometer, Wind, CloudRain, RefreshCcw } from 'lucide-react'
import { Card, CardHeader, CardMeta, CardTitle } from '../components/Card'
import { Spinner } from '../components/Spinner'
import { ErrorState } from '../components/ErrorState'
import { RiskBadge } from '../components/Badge'
import { Button } from '../components/Button'
import { RainChart } from '../components/RainChart'
import { useAsync } from '../hooks/useAsync'
import { getDashboard, getFloodPrediction, getWeather } from '../services/api'
import { maxRisk } from '../utils/risk'
import { useTranslation } from 'react-i18next'
import { RainForecastChart } from '../components/RainForecastChart'
export function DashboardPage() {
  const { t } = useTranslation()
  // Gọi /dashboard để lấy forecast24h có kèm flood_depth_cm (phục vụ tooltip)
  const dashboard = useAsync(getDashboard, [])
  // Vẫn giữ weather (demo) để không phá UI hiện tại; có thể bỏ sau khi đồng bộ hoàn toàn
  const weather = useAsync(getWeather, [])
  const flood = useAsync(getFloodPrediction, [])
  const [mode, setMode] = useState<'24h' | '3d'>('24h')

  const summary = useMemo(() => {
    const districts = flood.data?.districts ?? []
    const levels = districts.map((d) => d.risk)
    const overall = levels.length ? maxRisk(levels) : 'safe'
    const counts = levels.reduce(
      (acc, r) => ({ ...acc, [r]: (acc[r] ?? 0) + 1 }),
      {} as Record<string, number>,
    )
    return { overall, counts, total: districts.length }
  }, [flood.data])

  const loading = dashboard.loading || weather.loading || flood.loading
  const error = dashboard.error || weather.error || flood.error

  if (loading) return <Spinner label="Loading dashboard…" />
  if (error) return <ErrorState error={error} onRetry={() => void (weather.reload(), flood.reload())} />
  if (!weather.data || !flood.data || !dashboard.data) return null

  const w = weather.data.current

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-extrabold tracking-tight text-slate-900 dark:text-slate-100">{t('dashboard.title')}</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">{t('dashboard.subtitle')}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<RefreshCcw className="h-4 w-4" />}
          onClick={() => void (weather.reload(), flood.reload())}
        >
          {t('dashboard.refresh')}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t('dashboard.temperature')}</CardTitle>
              <CardMeta>{w.locationName}</CardMeta>
            </div>
            <Thermometer className="fps-3d-icon h-9 w-9 text-orange-500 drop-shadow-sm dark:text-orange-400" />
          </CardHeader>
          <div className="text-3xl font-extrabold text-orange-600 dark:text-orange-400">{w.temperatureC}°C</div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            {t('dashboard.observedAt')} {new Date(w.observedAtIso).toLocaleString()}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t('dashboard.humidity')}</CardTitle>
              <CardMeta>{t('weather.currentWeather')}</CardMeta>
            </div>
            <Droplets className="fps-3d-icon h-9 w-9 text-sky-600 drop-shadow-sm dark:text-sky-400" />
          </CardHeader>
          <div className="text-3xl font-extrabold text-sky-600 dark:text-sky-400">{w.humidityPct}%</div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('dashboard.comfortHint')}</div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t('dashboard.wind')}</CardTitle>
              <CardMeta>{t('weather.currentWeather')}</CardMeta>
            </div>
            <Wind className="fps-3d-icon h-9 w-9 text-cyan-600 drop-shadow-sm dark:text-cyan-400" />
          </CardHeader>
          <div className="text-3xl font-extrabold text-cyan-700 dark:text-cyan-300">{w.windKph} km/h</div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('dashboard.windHint')}</div>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>{t('dashboard.rainForecast')}</CardTitle>
              <CardMeta>{mode === '24h' ? t('dashboard.meta24h') : t('dashboard.meta3d')}</CardMeta>
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
            {mode === '24h' ? (
              <RainForecastChart points={dashboard.data.forecast24h ?? []} />
            ) : (
              // 3d vẫn dùng dữ liệu weather demo (có thể mở rộng backend sau)
              <RainChart mode="3d" forecast24h={weather.data.forecast24h} forecast3d={weather.data.forecast3d} />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t('dashboard.floodRiskSummary')}</CardTitle>
              <CardMeta>{t('dashboard.districtsCount', { count: summary.total })}</CardMeta>
            </div>
            <CloudRain className="fps-3d-icon h-9 w-9 text-indigo-600 drop-shadow-sm dark:text-indigo-400" />
          </CardHeader>
          <div className="flex items-center gap-3">
            <RiskBadge level={summary.overall} />
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {t('dashboard.overall')}: {t(`risk.${summary.overall}`)}
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-300">
            <div>
              {t('dashboard.riskCountSafe')}: {summary.counts.safe ?? 0}
            </div>
            <div>
              {t('dashboard.riskCountMedium')}: {summary.counts.medium ?? 0}
            </div>
            <div>
              {t('dashboard.riskCountHigh')}: {summary.counts.high ?? 0}
            </div>
            <div>
              {t('dashboard.riskCountSevere')}: {summary.counts.severe ?? 0}
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
