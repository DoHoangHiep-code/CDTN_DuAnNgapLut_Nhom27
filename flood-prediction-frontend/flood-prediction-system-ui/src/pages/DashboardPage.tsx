import { useCallback, useEffect, useRef, useState } from 'react'
import { Droplets, Thermometer, Wind, CloudRain, RefreshCcw, ExternalLink, Search, Clock, X } from 'lucide-react'
import { Card, CardHeader, CardMeta, CardTitle } from '../components/Card'
import { Spinner } from '../components/Spinner'
import { ErrorState } from '../components/ErrorState'
import { RiskBadge } from '../components/Badge'
import { Button } from '../components/Button'
import { RainForecastChart } from '../components/RainForecastChart'
import { TempHumidityChart } from '../components/TempHumidityChart'
import { RiskTrendChart } from '../components/RiskTrendChart'
import { getDashboard } from '../services/api'
import type { DashboardResponse } from '../utils/types'
import { useTranslation } from 'react-i18next'

const HOUR_OPTIONS = [
  { label: '6h',  value: 6  },
  { label: '12h', value: 12 },
  { label: '24h', value: 24 },
  { label: '48h', value: 48 },
]

export function DashboardPage() {
  const { t } = useTranslation()

  // ── Filter state ──────────────────────────────────────────────
  const [hours, setHours]   = useState(24)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  // ── Data state ────────────────────────────────────────────────
  const [data, setData]       = useState<DashboardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<unknown>(null)

  // Debounce search 400ms
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(t)
  }, [search])

  const fetchRef = useRef(0)
  const fetchDashboard = useCallback(async () => {
    const id = ++fetchRef.current
    setLoading(true)
    setError(null)
    try {
      const res = await getDashboard({ hours, search: debouncedSearch })
      if (id === fetchRef.current) setData(res)
    } catch (e) {
      if (id === fetchRef.current) setError(e)
    } finally {
      if (id === fetchRef.current) setLoading(false)
    }
  }, [hours, debouncedSearch])

  useEffect(() => { void fetchDashboard() }, [fetchDashboard])

  // ── Render ────────────────────────────────────────────────────
  if (loading && !data) return <Spinner label="Loading dashboard…" />
  if (error && !data)   return <ErrorState error={error} onRetry={fetchDashboard} />
  if (!data)            return null

  const cw          = data.currentWeather
  const riskSummary = data.riskSummary
  const forecast24h = data.forecast24h      ?? []
  const tempHum     = data.tempHumidity24h  ?? []
  const riskTrend   = data.riskTrend7d      ?? []
  const meta        = data.meta

  const riskLabel = hours <= 48 ? `${hours}h qua` : '7 ngày qua'

  return (
    <div className="space-y-5">
      {/* ── Header + actions ── */}
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
            leftIcon={<RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />}
            onClick={fetchDashboard}
            disabled={loading}
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

      {/* ── Filter bar ── */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        {/* Time range */}
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Khoảng thời gian:</span>
          <div className="flex gap-1">
            {HOUR_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setHours(opt.value)}
                className={`rounded-lg px-3 py-1 text-xs font-bold transition ${
                  hours === opt.value
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />

        {/* Location search */}
        <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 dark:border-slate-700 dark:bg-slate-800">
          <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm trạm theo tên địa điểm…"
            className="flex-1 bg-transparent text-xs text-slate-700 placeholder-slate-400 outline-none dark:text-slate-200"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} className="text-slate-400 hover:text-slate-600">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Resolved nodes badge */}
        {meta && (
          <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
            {meta.resolvedNodes.length} trạm
            {meta.search ? ` · "${meta.search}"` : ' (mặc định)'}
          </span>
        )}

        {loading && (
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
            Đang tải…
          </span>
        )}
      </div>

      {/* Resolved nodes list (chỉ hiện khi search) */}
      {meta?.search && meta.resolvedNodes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {meta.resolvedNodes.map((n) => (
            <span key={n.id} className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {n.name}
            </span>
          ))}
        </div>
      )}

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
            Trung bình các trạm đang chọn
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

      {/* ── Hàng 2: Mưa + Ngập | Nguy cơ ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>{t('dashboard.rainForecast')}</CardTitle>
              <CardMeta>Lượng mưa & độ ngập · {riskLabel} (CockroachDB)</CardMeta>
            </div>
          </CardHeader>
          <div className="h-56 min-h-[14rem]">
            <RainForecastChart points={forecast24h} />
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t('dashboard.floodRiskSummary')}</CardTitle>
              <CardMeta>flood_predictions · {riskLabel}</CardMeta>
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

      {/* ── Hàng 3: Nhiệt độ/Độ ẩm | Xu hướng nguy cơ ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Nhiệt độ & Độ ẩm</CardTitle>
              <CardMeta>{riskLabel} · weather_measurements (CockroachDB)</CardMeta>
            </div>
          </CardHeader>
          <div className="h-52 min-h-[13rem]">
            <TempHumidityChart points={tempHum} />
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Xu hướng nguy cơ ngập</CardTitle>
              <CardMeta>{hours <= 48 ? riskLabel : '7 ngày qua'} · flood_predictions (CockroachDB)</CardMeta>
            </div>
          </CardHeader>
          <div className="h-52 min-h-[13rem]">
            <RiskTrendChart days={riskTrend} />
          </div>
        </Card>
      </div>
    </div>
  )
}
