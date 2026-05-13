import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import {
  Download, FileText, FileSpreadsheet, Filter,
  Calendar, MapPin, AlertTriangle, CheckCircle,
  RefreshCcw, X, TrendingUp, BarChart3, Search,
  Cloud, Droplets, Thermometer, Loader2,
} from 'lucide-react'

import { ErrorState } from '../components/ErrorState'
import { Spinner } from '../components/Spinner'
import { useAsync } from '../hooks/useAsync'
import { useDebounce } from '../hooks/useDebounce'
import { getReports, getReportsAutocomplete, getAlertsBanner } from '../services/api'
import type { AlertsBannerItem, ReportsRow } from '../utils/types'
import { useTranslation } from 'react-i18next'
import { cn } from '../utils/cn'

// ── Helpers ───────────────────────────────────────────────────────────
function toVNDate(iso: string) {
  return new Date(iso).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' })
}
function toVNTime(iso: string) {
  return new Date(iso).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' })
}

// ── Risk / Level configs ──────────────────────────────────────────────
const RISK_CONFIG = {
  safe:   { label: 'An toàn',   bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-400', dot: 'bg-emerald-500', border: 'border-emerald-200 dark:border-emerald-800' },
  medium: { label: 'Trung bình',bg: 'bg-amber-50 dark:bg-amber-950/30',    text: 'text-amber-700 dark:text-amber-500',     dot: 'bg-amber-400',   border: 'border-amber-200 dark:border-amber-800' },
  high:   { label: 'Cao',       bg: 'bg-orange-50 dark:bg-orange-950/30',  text: 'text-orange-700 dark:text-orange-400',   dot: 'bg-orange-500',  border: 'border-orange-200 dark:border-orange-800' },
  severe: { label: 'Nguy hiểm', bg: 'bg-red-50 dark:bg-red-950/30',        text: 'text-red-700 dark:text-red-400',         dot: 'bg-red-500',     border: 'border-red-200 dark:border-red-800' },
} as const

type LevelCfg = { label: string; bg: string; text: string; dot: string; border: string; icon: typeof CheckCircle }
const LEVEL_CONFIG: Record<string, LevelCfg> = {
  'Khô ráo': { label: 'Khô ráo',   bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-400', dot: 'bg-emerald-500', border: 'border-emerald-200 dark:border-emerald-800', icon: CheckCircle },
  '<15cm':   { label: '<15cm',      bg: 'bg-amber-50 dark:bg-amber-950/30',     text: 'text-amber-700 dark:text-amber-500',     dot: 'bg-amber-400',   border: 'border-amber-200 dark:border-amber-800',   icon: AlertTriangle },
  '15-30cm': { label: '15-30cm',    bg: 'bg-orange-50 dark:bg-orange-950/30',   text: 'text-orange-700 dark:text-orange-400',   dot: 'bg-orange-500',  border: 'border-orange-200 dark:border-orange-800', icon: AlertTriangle },
  '>30cm':   { label: '>30cm',      bg: 'bg-red-50 dark:bg-red-950/30',         text: 'text-red-700 dark:text-red-400',         dot: 'bg-red-500',     border: 'border-red-200 dark:border-red-800',       icon: AlertTriangle },
}

function LevelBadge({ level }: { level: string }) {
  const cfg = LEVEL_CONFIG[level]
  if (!cfg) return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{level}</span>
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold', cfg.bg, cfg.text, cfg.border)}>
      <span className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', cfg.dot)} />
      {cfg.label}
    </span>
  )
}

// ── Export helpers ────────────────────────────────────────────────────
function exportCsv(rows: ReportsRow[]) {
  const csv = Papa.unparse(rows.map((r) => ({
    'Ngày': `${toVNDate(r.createdAtIso)} ${toVNTime(r.createdAtIso)}`,
    'Trạm / Nguồn': r.locationName ?? r.districtName ?? `${r.latitude.toFixed(4)},${r.longitude.toFixed(4)}`,
    'Quận': r.districtName ?? '',
    'Mức ngập': r.reportedLevel,
  })))
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `flood-reports-${new Date().toISOString().slice(0, 10)}.csv`
  a.click(); URL.revokeObjectURL(url)
}

function exportExcel(rows: ReportsRow[]) {
  const ws = XLSX.utils.json_to_sheet(rows.map((r) => ({
    'Ngày': `${toVNDate(r.createdAtIso)} ${toVNTime(r.createdAtIso)}`,
    'Trạm / Nguồn': r.locationName ?? r.districtName ?? '',
    'Quận': r.districtName ?? '',
    'Mức ngập': r.reportedLevel,
  })))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Reports')
  XLSX.writeFile(wb, `flood-reports-${new Date().toISOString().slice(0, 10)}.xlsx`)
}

async function exportPdf() {
  const el = document.getElementById('reports-table-container')
  if (!el) return
  const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' })
  const imgData = canvas.toDataURL('image/png')
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [canvas.width / 2, canvas.height / 2] })
  pdf.addImage(imgData, 'PNG', 0, 0, canvas.width / 2, canvas.height / 2)
  pdf.save(`flood-reports-${new Date().toISOString().slice(0, 10)}.pdf`)
}

// ── District Weather Cards ────────────────────────────────────────────
function DistrictCards({ items }: { items: AlertsBannerItem[] }) {
  if (!items.length) return null
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((item) => {
        const riskCfg = RISK_CONFIG[item.riskLevel] ?? RISK_CONFIG.safe
        return (
          <div
            key={item.district}
            className={cn(
              'overflow-hidden rounded-2xl border p-3.5 transition-all hover:-translate-y-0.5 hover:shadow-md',
              riskCfg.bg, riskCfg.border,
            )}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-1">
              <div className="min-w-0">
                <div className="truncate text-[11px] font-extrabold text-slate-700 dark:text-slate-200">{item.district}</div>
                <span className={cn('mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold', riskCfg.text)}>
                  <span className={cn('h-1.5 w-1.5 rounded-full', riskCfg.dot)} />
                  {riskCfg.label}
                </span>
              </div>
              {item.floodDepthCm > 0 && (
                <div className={cn('text-right text-xs font-extrabold tabular-nums', riskCfg.text)}>
                  {item.floodDepthCm}cm
                </div>
              )}
            </div>
            {/* Stats */}
            <div className="mt-2.5 space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="flex items-center gap-1 text-slate-500"><Thermometer className="h-3 w-3" /></span>
                <span className="font-bold text-slate-700 dark:text-slate-200 tabular-nums">{item.temp}°C</span>
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="flex items-center gap-1 text-slate-500"><Droplets className="h-3 w-3 text-sky-500" /></span>
                <span className="font-bold text-sky-600 dark:text-sky-400 tabular-nums">{item.rain1h}mm/h</span>
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="flex items-center gap-1 text-slate-500"><Cloud className="h-3 w-3 text-slate-400" /></span>
                <span className="font-semibold text-slate-500 tabular-nums">{item.cloudsPct}%</span>
              </div>
            </div>
            {!item.hasData && (
              <div className="mt-1.5 text-[9px] italic text-slate-400">Chưa có dữ liệu</div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Classic Location Search (commit-on-Enter/click, no live filter) ──
type AutocompleteItem = { name: string; type: 'district' | 'node' }

function ClassicLocationSearch({
  value,
  onChange,
  onCommit,
  onClear,
}: {
  value: string
  onChange: (v: string) => void
  onCommit: (v: string) => void
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<AutocompleteItem[]>([])
  const [loading, setLoading] = useState(false)
  const debounced = useDebounce(value, 400)
  const abortRef = useRef<AbortController | null>(null)

  // Chỉ fetch gợi ý khi đang gõ — KHÔNG gọi API chính
  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.length < 2) { setSuggestions([]); return }
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    setLoading(true)
    try {
      const results = await getReportsAutocomplete(q)
      setSuggestions(results)
    } finally {
      setLoading(false)
    }
  }, [])

  // Trigger fetch khi debounced thay đổi
  useMemo(() => { fetchSuggestions(debounced) }, [debounced, fetchSuggestions])

  function commit(v: string) {
    onChange(v)
    setSuggestions([])
    setOpen(false)
    onCommit(v)
  }

  return (
    <div className="relative w-full">
      {loading
        ? <Loader2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-indigo-400" />
        : <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      }
      <input
        type="text"
        value={value}
        placeholder="Tên quận/huyện hoặc địa điểm…"
        autoComplete="off"
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(value.trim()) }
          if (e.key === 'Escape') setOpen(false)
        }}
        className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-8 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-indigo-900/40"
      />
      {value && (
        <button
          type="button"
          onClick={() => { onChange(''); setSuggestions([]); onClear() }}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {open && suggestions.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-[500] mt-1 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          {suggestions.map((s, i) => (
            <li key={`${s.type}_${i}`}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-800 hover:bg-indigo-50 dark:text-slate-100 dark:hover:bg-slate-800"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(s.name)}
              >
                <MapPin className={cn('h-3.5 w-3.5 flex-shrink-0', s.type === 'district' ? 'text-indigo-400' : 'text-slate-400')} />
                <span>{s.name}</span>
                <span className="ml-auto text-[10px] text-slate-400">{s.type === 'district' ? 'Quận' : 'Địa điểm'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── ReportsPage ───────────────────────────────────────────────────────
export function ReportsPage() {
  const { t } = useTranslation()

  // ── Filter state (Classic: chỉ apply khi commit) ──
  const [locationInput, setLocationInput] = useState('')
  const [committedLocation, setCommittedLocation] = useState('')  // dùng để gọi API
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [committedDateFrom, setCommittedDateFrom] = useState('')
  const [committedDateTo, setCommittedDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [exporting, setExporting] = useState(false)

  // Auto-load today's data on mount
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10)
    setDateFrom(today)
    setDateTo(today)
    setCommittedDateFrom(today)
    setCommittedDateTo(today)
  }, [])

  // ── Build API params từ committed values ──
  const reportsParams = useMemo(() => ({
    location: committedLocation || undefined,
    dateFrom: committedDateFrom || undefined,
    dateTo:   committedDateTo   || undefined,
    page,
    limit: 50,
  }), [committedLocation, committedDateFrom, committedDateTo, page])

  const reports = useAsync(() => getReports(reportsParams), [reportsParams])
  const banner  = useAsync(getAlertsBanner, [])

  const rows: ReportsRow[] = useMemo(() => reports.data?.rows ?? [], [reports.data])
  const pagination = reports.data?.pagination

  const hasFilters = Boolean(committedLocation || committedDateFrom || committedDateTo)

  // Stats
  const stats = useMemo(() => {
    const c: Record<string, number> = {}
    rows.forEach((r) => { c[r.reportedLevel] = (c[r.reportedLevel] ?? 0) + 1 })
    return c
  }, [rows])

  // ── Apply filter (commit) ──
  function applyFilters() {
    setCommittedLocation(locationInput)
    setCommittedDateFrom(dateFrom)
    setCommittedDateTo(dateTo)
    setPage(1)
  }

  function clearFilters() {
    setLocationInput(''); setCommittedLocation('')
    setDateFrom('');       setCommittedDateFrom('')
    setDateTo('');         setCommittedDateTo('')
    setPage(1)
  }

  if (reports.loading && !reports.data) return <Spinner label="Loading reports…" />
  if (reports.error) return <ErrorState error={reports.error} onRetry={reports.reload} />

  return (
    <div className="space-y-4">

      {/* ── Page header ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-200 dark:shadow-indigo-900/40">
            <FileText className="h-6 w-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
              {t('reports.title')}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('reports.filterHint')}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { reports.reload(); banner.reload() }}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
        >
          <RefreshCcw className="h-3.5 w-3.5" /> Làm mới
        </button>
      </div>

      {/* ── District Weather Cards ── */}
      {banner.data && banner.data.length > 0 && (
        <DistrictCards items={banner.data} />
      )}

      {/* ── Stats mini row ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Tổng báo cáo',     value: pagination?.total ?? rows.length, icon: BarChart3,    color: 'bg-indigo-100 dark:bg-indigo-900/40',  iconColor: 'text-indigo-500' },
          { label: 'Khô ráo',          value: stats['Khô ráo'] ?? 0,            icon: CheckCircle,  color: 'bg-emerald-100 dark:bg-emerald-900/40', iconColor: 'text-emerald-500' },
          { label: 'Ngập nhẹ (<30cm)', value: (stats['<15cm'] ?? 0) + (stats['15-30cm'] ?? 0), icon: AlertTriangle, color: 'bg-amber-100 dark:bg-amber-900/40', iconColor: 'text-amber-500' },
          { label: 'Ngập nặng (>30cm)', value: stats['>30cm'] ?? 0,             icon: TrendingUp,   color: 'bg-red-100 dark:bg-red-900/40',         iconColor: 'text-red-500' },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className={cn('grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl', s.color)}>
              <s.icon className={cn('h-5 w-5', s.iconColor)} />
            </div>
            <div>
              <div className="text-xs text-slate-400 dark:text-slate-500">{s.label}</div>
              <div className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 tabular-nums">{s.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Main layout: table + filter ── */}
      <div className="grid grid-cols-12 gap-4">

        {/* ── Table (col 8) ── */}
        <div className="col-span-12 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 lg:col-span-8">

          {/* Table toolbar */}
          <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-extrabold text-slate-900 dark:text-slate-100">
                {t('reports.predictionData')}
              </div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {pagination ? `${pagination.total} báo cáo` : `${rows.length} báo cáo`}
                {hasFilters && <span className="ml-1 rounded-full bg-indigo-100 px-1.5 py-0.5 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400">đang lọc</span>}
                {reports.loading && <Loader2 className="ml-2 inline h-3 w-3 animate-spin text-slate-400" />}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => exportCsv(rows)}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                <Download className="h-3.5 w-3.5" /> CSV
              </button>
              <button type="button" onClick={() => exportExcel(rows)}
                className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 shadow-sm hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
              </button>
              <button type="button" disabled={exporting}
                onClick={async () => { setExporting(true); try { await exportPdf() } finally { setExporting(false) } }}
                className="flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 shadow-sm hover:bg-red-100 disabled:opacity-50 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
                <FileText className="h-3.5 w-3.5" /> {exporting ? 'Đang xuất…' : 'PDF'}
              </button>
            </div>
          </div>

          {/* Table body */}
          <div id="reports-table-container" className="overflow-auto">
            <table className="w-full min-w-[640px] text-left">
              <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800/80">
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">#</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    <span className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" />{t('reports.date')}</span>
                  </th>
                  {/* Đổi "Người báo cáo" → "Nguồn dữ liệu / Trạm" */}
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    <span className="flex items-center gap-1.5"><BarChart3 className="h-3.5 w-3.5" />Nguồn / Trạm</span>
                  </th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />Khu vực</span>
                  </th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">Mức ngập</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map((r, idx) => {
                  const locationLabel = r.locationName ?? (r.districtName ?? `${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)}`)
                  const sourceLabel = r.userFullName ?? 'AI CatBoost'
                  const isAI = !r.userFullName
                  return (
                    <tr key={r.id} className="group transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/30">
                      {/* # */}
                      <td className="px-4 py-3.5">
                        <span className="text-xs font-bold tabular-nums text-slate-300 dark:text-slate-600">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                      </td>
                      {/* Date */}
                      <td className="px-4 py-3.5">
                        <div className="text-xs font-bold text-slate-800 dark:text-slate-100">{toVNTime(r.createdAtIso)}</div>
                        <div className="text-[10px] text-slate-400">{toVNDate(r.createdAtIso)}</div>
                      </td>
                      {/* Source / Station */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          {isAI ? (
                            <span className="inline-flex items-center gap-1 rounded-lg bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-600 dark:bg-violet-900/30 dark:text-violet-300">
                              ✦ AI
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-lg bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-600 dark:bg-sky-900/30 dark:text-sky-300">
                              👤
                            </span>
                          )}
                          <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{sourceLabel}</span>
                        </div>
                      </td>
                      {/* Location */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-start gap-1.5">
                          <MapPin className="mt-0.5 h-3 w-3 flex-shrink-0 text-slate-400" />
                          <div>
                            <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 leading-snug">{locationLabel}</div>
                            {r.districtName && r.locationName && (
                              <div className="text-[10px] text-slate-400">{r.districtName}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      {/* Level */}
                      <td className="px-4 py-3.5">
                        <LevelBadge level={r.reportedLevel} />
                      </td>
                    </tr>
                  )
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-16 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <FileText className="h-10 w-10 text-slate-200 dark:text-slate-700" />
                        <div className="text-sm font-semibold text-slate-400 dark:text-slate-500">{t('reports.noData')}</div>
                        {hasFilters && (
                          <button type="button" onClick={clearFilters}
                            className="mt-1 text-xs font-semibold text-indigo-500 underline hover:text-indigo-700">
                            Xóa bộ lọc để xem toàn bộ
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 dark:border-slate-800">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300">
                ← Trước
              </button>
              <span className="text-xs text-slate-500">Trang {pagination.page} / {pagination.totalPages}</span>
              <button type="button" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300">
                Tiếp →
              </button>
            </div>
          )}
        </div>

        {/* ── Filter panel (col 4) ── */}
        <div className="col-span-12 lg:col-span-4 space-y-4">

          {/* Filter card */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3.5 dark:border-slate-800">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-100 dark:bg-indigo-900/40">
                <Filter className="h-4 w-4 text-indigo-500" />
              </div>
              <div>
                <div className="text-sm font-extrabold text-slate-800 dark:text-slate-100">{t('reports.filters')}</div>
                <div className="text-[11px] text-slate-400">Nhấn Enter hoặc "Áp dụng" để tìm kiếm</div>
              </div>
              {hasFilters && (
                <button type="button" onClick={clearFilters}
                  className="ml-auto flex items-center gap-1 rounded-lg bg-red-50 px-2 py-1 text-[11px] font-bold text-red-500 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400">
                  <X className="h-3 w-3" /> Xóa
                </button>
              )}
            </div>

            <div className="space-y-4 p-4">
              {/* Location search (Classic: commit-on-Enter) */}
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-400">
                  <MapPin className="h-3.5 w-3.5" />{t('reports.district')}
                </label>
                <ClassicLocationSearch
                  value={locationInput}
                  onChange={setLocationInput}
                  onCommit={(v) => { setCommittedLocation(v); setPage(1) }}
                  onClear={() => { setCommittedLocation(''); setPage(1) }}
                />
                <p className="mt-1 text-[10px] text-slate-400">Nhấn Enter để tìm — không lọc tức thì</p>
              </div>

              {/* Date range */}
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-400">
                  <Calendar className="h-3.5 w-3.5" />Từ ngày
                </label>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-indigo-900/40" />
              </div>
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-400">
                  <Calendar className="h-3.5 w-3.5" />Đến ngày
                </label>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-indigo-900/40" />
              </div>

              {/* Apply button */}
              <button type="button" onClick={applyFilters}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-indigo-700 active:scale-95">
                <Search className="h-4 w-4" /> Áp dụng bộ lọc
              </button>

              {/* Active filter badges */}
              {hasFilters && (
                <div className="space-y-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Đang lọc</div>
                  {committedLocation && (
                    <div className="flex items-center gap-2 rounded-lg bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                      <MapPin className="h-3 w-3" /> {committedLocation}
                    </div>
                  )}
                  {committedDateFrom && (
                    <div className="flex items-center gap-2 rounded-lg bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                      <Calendar className="h-3 w-3" /> Từ {new Date(committedDateFrom).toLocaleDateString('vi-VN')}
                    </div>
                  )}
                  {committedDateTo && (
                    <div className="flex items-center gap-2 rounded-lg bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                      <Calendar className="h-3 w-3" /> Đến {new Date(committedDateTo).toLocaleDateString('vi-VN')}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Level breakdown */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="border-b border-slate-100 px-4 py-3.5 dark:border-slate-800">
              <div className="text-sm font-extrabold text-slate-800 dark:text-slate-100">Phân bổ mức ngập</div>
              <div className="text-[11px] text-slate-400">{rows.length} báo cáo trong trang này</div>
            </div>
            <div className="space-y-2 p-4">
              {Object.entries(LEVEL_CONFIG).map(([key, cfg]) => {
                const count = stats[key] ?? 0
                const pct = rows.length ? Math.round((count / rows.length) * 100) : 0
                return (
                  <div key={key}>
                    <div className="mb-1 flex items-center justify-between">
                      <span className={cn('flex items-center gap-1.5 text-xs font-semibold', cfg.text)}>
                        <span className={cn('h-2 w-2 rounded-full', cfg.dot)} />{cfg.label}
                      </span>
                      <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                        {count} <span className="text-[10px] font-normal">({pct}%)</span>
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div className={cn('h-full rounded-full transition-all duration-500', cfg.dot)} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
