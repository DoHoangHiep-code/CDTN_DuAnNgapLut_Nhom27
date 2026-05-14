import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCcw, ExternalLink, Search, Clock, X } from 'lucide-react'
import { Spinner } from '../../components/Spinner'
import { ErrorState } from '../../components/ErrorState'
import { Button } from '../../components/Button'
import { DashboardCards } from './components/DashboardCards'
import { DashboardCharts } from './components/DashboardCharts'
import { getDashboard } from '../../services/api'
import type { DashboardResponse } from '../../utils/types'
import { useTranslation } from 'react-i18next'

const HOUR_OPTIONS = [
  { label: '6h',  value: 6  },
  { label: '12h', value: 12 },
  { label: '24h', value: 24 },
  { label: '48h', value: 48 },
  { label: '72h', value: 72 },
]

export function DashboardPage() {
  const { t } = useTranslation()

  // ── Filter state ──────────────────────────────────────────────
  const [hours, setHours]   = useState(72)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  // ── Autocomplete state ────────────────────────────────────────
  const [suggestions, setSuggestions] = useState<import('../../utils/types').DashboardAutocompleteItem[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // ── Data state ────────────────────────────────────────────────
  const [data, setData]       = useState<DashboardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<unknown>(null)

  // Debounce search for suggestions (400ms)
  useEffect(() => {
    const t = setTimeout(() => {
      if (search.trim()) {
        setLoadingSuggestions(true)
        import('../../services/api').then(({ getDashboardAutocomplete }) => {
          getDashboardAutocomplete(search).then(setSuggestions).catch(() => setSuggestions([])).finally(() => setLoadingSuggestions(false))
        })
      } else {
        setSuggestions([])
      }
    }, 400)
    return () => clearTimeout(t)
  }, [search])

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const fetchRef = useRef(0)
  const fetchDashboard = useCallback(async () => {
    const id = ++fetchRef.current
    setLoading(true)
    setError(null)
    try {
      const res = await getDashboard({ hours: 72, search: debouncedSearch })
      if (id === fetchRef.current) setData(res)
    } catch (e) {
      if (id === fetchRef.current) setError(e)
    } finally {
      if (id === fetchRef.current) setLoading(false)
    }
  }, [debouncedSearch])

  useEffect(() => { void fetchDashboard() }, [fetchDashboard])

  // ── Render ────────────────────────────────────────────────────
  if (loading && !data) return <Spinner label="Loading dashboard…" />
  if (error && !data)   return <ErrorState error={error} onRetry={fetchDashboard} />
  if (!data)            return null

  const cw          = data.currentWeather
  const riskSummary = data.riskSummary
  const forecast24h = (data.forecast24h      ?? []).slice(0, hours)
  const tempHum     = (data.tempHumidity24h  ?? []).slice(0, hours)
  const riskTrend   = (data.riskTrend7d      ?? []).slice(0, hours)
  const meta        = data.meta

  const riskLabel = hours <= 48 ? `${hours}h tới` : '7 ngày tới'

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
        <div ref={dropdownRef} className="relative flex min-w-[200px] flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 dark:border-slate-700 dark:bg-slate-800">
          <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <input
            type="text"
            value={search}
            onFocus={() => { if (search.trim()) setShowDropdown(true) }}
            onChange={(e) => {
              setSearch(e.target.value)
              setShowDropdown(true)
              if (!e.target.value) {
                setDebouncedSearch('')
                setShowDropdown(false)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setDebouncedSearch(search)
                setShowDropdown(false)
              }
            }}
            placeholder="Tìm trạm theo tên địa điểm…"
            className="flex-1 bg-transparent text-xs text-slate-700 placeholder-slate-400 outline-none dark:text-slate-200"
          />
          {search && (
            <button type="button" onClick={() => { setSearch(''); setDebouncedSearch(''); setShowDropdown(false); }} className="text-slate-400 hover:text-slate-600">
              <X className="h-3.5 w-3.5" />
            </button>
          )}

          {/* Autocomplete Dropdown */}
          {showDropdown && search.trim() && (
            <div className="absolute left-0 top-full z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
              {loadingSuggestions ? (
                <div className="p-3 text-center text-xs text-slate-500">Đang tìm...</div>
              ) : suggestions.length > 0 ? (
                <ul className="py-1">
                  {suggestions.map((s) => (
                    <li key={s.node_id}>
                      <button
                        type="button"
                        className="w-full px-4 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700"
                        onClick={() => {
                          setSearch(s.location_name)
                          setDebouncedSearch(s.location_name)
                          setShowDropdown(false)
                        }}
                      >
                        <div className="font-medium text-slate-700 dark:text-slate-200">{s.location_name}</div>
                        <div className="text-xs text-slate-500">{s.district_name}</div>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="p-3 text-center text-xs text-slate-500">Không tìm thấy địa điểm</div>
              )}
            </div>
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

      <DashboardCards cw={cw} />

      <DashboardCharts
        forecast24h={forecast24h}
        tempHum={tempHum}
        riskTrend={riskTrend}
        riskSummary={riskSummary}
        riskLabel={riskLabel}
        hours={hours}
      />
    </div>
  )
}
