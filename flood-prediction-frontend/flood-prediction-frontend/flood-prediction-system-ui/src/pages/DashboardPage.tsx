import { useMemo, useState } from 'react'
import { Droplets, Thermometer, Wind, CloudRain, RefreshCcw } from 'lucide-react'
import { Card, CardHeader, CardMeta, CardTitle } from '../components/Card'
import { Spinner } from '../components/Spinner'
import { ErrorState } from '../components/ErrorState'
import { RiskBadge } from '../components/Badge'
import { Button } from '../components/Button'
import { RainChart } from '../components/RainChart'
import { useAsync } from '../hooks/useAsync'
import { getFloodPrediction, getWeather } from '../services/api'
import { maxRisk } from '../utils/risk'
import { useTranslation } from 'react-i18next'

export function DashboardPage() {
  const { t } = useTranslation()
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

  const loading = weather.loading || flood.loading
  const error = weather.error || flood.error

  if (loading) return <Spinner label="Loading dashboard…" />
  if (error) return <ErrorState error={error} onRetry={() => void (weather.reload(), flood.reload())} />
  if (!weather.data || !flood.data) return null

  const w = weather.data.current

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-extrabold tracking-tight text-slate-900 dark:text-slate-100">Dashboard</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Current weather and flood risk summary for key districts
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<RefreshCcw className="h-4 w-4" />}
          onClick={() => void (weather.reload(), flood.reload())}
        >
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Temperature</CardTitle>
              <CardMeta>{w.locationName}</CardMeta>
            </div>
            <Thermometer className="h-5 w-5 text-sky-600 dark:text-sky-400" />
          </CardHeader>
          <div className="text-3xl font-extrabold text-slate-900 dark:text-white">{w.temperatureC}°C</div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">Observed at {new Date(w.observedAtIso).toLocaleString()}</div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Humidity</CardTitle>
              <CardMeta>Current</CardMeta>
            </div>
            <Droplets className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          </CardHeader>
          <div className="text-3xl font-extrabold text-slate-900 dark:text-white">{w.humidityPct}%</div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">Comfort index (demo)</div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Wind</CardTitle>
              <CardMeta>Current</CardMeta>
            </div>
            <Wind className="h-5 w-5 text-slate-700 dark:text-slate-200" />
          </CardHeader>
          <div className="text-3xl font-extrabold text-slate-900 dark:text-white">{w.windKph} km/h</div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">Gusts not included</div>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Rain Forecast</CardTitle>
              <CardMeta>{mode === '24h' ? 'Next 24 hours' : 'Next 3 days'}</CardMeta>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant={mode === '24h' ? 'secondary' : 'ghost'} onClick={() => setMode('24h')}>
                24h
              </Button>
              <Button size="sm" variant={mode === '3d' ? 'secondary' : 'ghost'} onClick={() => setMode('3d')}>
                3 days
              </Button>
            </div>
          </CardHeader>
          <div className="h-56">
            <RainChart mode={mode} forecast24h={weather.data.forecast24h} forecast3d={weather.data.forecast3d} />
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Flood Risk Summary</CardTitle>
              <CardMeta>{summary.total} districts</CardMeta>
            </div>
            <CloudRain className="h-5 w-5 text-sky-700 dark:text-sky-300" />
          </CardHeader>
          <div className="flex items-center gap-3">
            <RiskBadge level={summary.overall} />
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Overall: {t(`risk.${summary.overall}`)}
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-300">
            <div>Safe: {summary.counts.safe ?? 0}</div>
            <div>Medium: {summary.counts.medium ?? 0}</div>
            <div>High: {summary.counts.high ?? 0}</div>
            <div>Severe: {summary.counts.severe ?? 0}</div>
          </div>
        </Card>
      </div>
    </div>
  )
}

