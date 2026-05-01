import { useMemo, useState } from 'react'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import {
  Download, FileText, FileSpreadsheet, Filter,
  Calendar, MapPin, User, AlertTriangle, CheckCircle,
  RefreshCcw, X, TrendingUp, BarChart3,
} from 'lucide-react'

import { ErrorState } from '../components/ErrorState'
import { Spinner } from '../components/Spinner'
import { useAsync } from '../hooks/useAsync'
import { useReverseGeocode } from '../hooks/useReverseGeocode'
import { getReports } from '../services/api'
import { LocationSearch } from '../components/LocationSearch'
import type { ReportsResponse } from '../utils/types'
import { useTranslation } from 'react-i18next'
import { cn } from '../utils/cn'

type ActualReportRow = ReportsResponse['rows'][number]

function toVN(isoStr: string): string {
  return new Date(isoStr).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
}

function toVNDate(isoStr: string): string {
  return new Date(isoStr).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' })
}

function toVNTime(isoStr: string): string {
  return new Date(isoStr).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' })
}

const LEVEL_CONFIG: Record<string, {
  bg: string; text: string; border: string; dot: string; icon: typeof CheckCircle; label: string
}> = {
  'Khô ráo': {
    bg: 'bg-emerald-50 dark:bg-emerald-950/30',
    text: 'text-emerald-700 dark:text-emerald-400',
    border: 'border-emerald-200 dark:border-emerald-800',
    dot: 'bg-emerald-500',
    icon: CheckCircle,
    label: 'Khô ráo',
  },
  '<15cm': {
    bg: 'bg-yellow-50 dark:bg-yellow-950/30',
    text: 'text-yellow-700 dark:text-yellow-500',
    border: 'border-yellow-200 dark:border-yellow-800',
    dot: 'bg-yellow-400',
    icon: AlertTriangle,
    label: '<15cm',
  },
  '15-30cm': {
    bg: 'bg-orange-50 dark:bg-orange-950/30',
    text: 'text-orange-700 dark:text-orange-400',
    border: 'border-orange-200 dark:border-orange-800',
    dot: 'bg-orange-500',
    icon: AlertTriangle,
    label: '15-30cm',
  },
  '>30cm': {
    bg: 'bg-red-50 dark:bg-red-950/30',
    text: 'text-red-700 dark:text-red-400',
    border: 'border-red-200 dark:border-red-800',
    dot: 'bg-red-500',
    icon: AlertTriangle,
    label: '>30cm',
  },
}

function LevelBadge({ level }: { level: string }) {
  const cfg = LEVEL_CONFIG[level]
  if (!cfg) return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{level}</span>
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold',
      cfg.bg, cfg.text, cfg.border,
    )}>
      <span className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0', cfg.dot)} />
      {cfg.label}
    </span>
  )
}

function UserAvatar({ name }: { name: string | null }) {
  const initials = name
    ? name.split(' ').map((w) => w[0]).slice(-2).join('').toUpperCase()
    : '?'
  const colors = [
    'bg-sky-500', 'bg-violet-500', 'bg-rose-500', 'bg-amber-500', 'bg-emerald-500', 'bg-indigo-500',
  ]
  const color = colors[(name?.length ?? 0) % colors.length]
  return (
    <div className={cn('grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg text-[10px] font-extrabold text-white', color)}>
      {initials}
    </div>
  )
}

function exportCsv(rows: ActualReportRow[], getLocation: (lat: number, lng: number) => string) {
  const csv = Papa.unparse(rows.map((r) => ({
    'Ngày': toVN(r.createdAtIso),
    'User': r.userFullName ?? '',
    'Khu vực': getLocation(r.latitude, r.longitude),
    'Mức ngập': r.reportedLevel,
  })))
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url
  a.download = `flood-reports-${new Date().toISOString().slice(0, 10)}.csv`
  a.click(); URL.revokeObjectURL(url)
}

function exportExcel(rows: ActualReportRow[], getLocation: (lat: number, lng: number) => string) {
  const ws = XLSX.utils.json_to_sheet(rows.map((r) => ({
    'Ngày': toVN(r.createdAtIso), 'User': r.userFullName ?? '',
    'Khu vực': getLocation(r.latitude, r.longitude), 'Mức ngập': r.reportedLevel,
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

export function ReportsPage() {
  const { t } = useTranslation()
  const [date, setDate] = useState('')
  const [districtInput, setDistrictInput] = useState('')
  const [districtFilter, setDistrictFilter] = useState('')
  const [exporting, setExporting] = useState(false)
  const [page, setPage] = useState(1)

  // Không dùng getFloodPrediction() nữa (tránh scan 53K nodes)
  // Danh sách quận được thay bằng Nominatim geo-search
  const reports = useAsync(
    () => getReports({ date: date || undefined, district: districtFilter || undefined }),
    [date, districtFilter],
  )

  const rows = useMemo(() => reports.data?.rows ?? [], [reports.data])
  const pagination = reports.data?.pagination

  const coords = useMemo(() => rows.map((r) => ({ lat: r.latitude, lng: r.longitude })), [rows])
  const { getLocation } = useReverseGeocode(coords)

  const hasFilters = Boolean(date || districtFilter)

  // Stats tính từ rows
  const stats = useMemo(() => {
    const counts: Record<string, number> = {}
    rows.forEach((r) => { counts[r.reportedLevel] = (counts[r.reportedLevel] ?? 0) + 1 })
    return counts
  }, [rows])

  if (reports.loading) return <Spinner label="Loading reports…" />
  if (reports.error) return <ErrorState error={reports.error} onRetry={reports.reload} />

  return (
    <div className="space-y-5">

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
          onClick={() => reports.reload()}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
        >
          <RefreshCcw className="h-3.5 w-3.5" /> Làm mới
        </button>
      </div>

      {/* ── Stats mini row ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Tổng báo cáo', value: rows.length, icon: BarChart3, color: 'bg-indigo-100 dark:bg-indigo-900/40', iconColor: 'text-indigo-500' },
          { label: 'Khô ráo', value: stats['Khô ráo'] ?? 0, icon: CheckCircle, color: 'bg-emerald-100 dark:bg-emerald-900/40', iconColor: 'text-emerald-500' },
          { label: 'Ngập nhẹ (<15cm)', value: (stats['<15cm'] ?? 0) + (stats['15-30cm'] ?? 0), icon: AlertTriangle, color: 'bg-amber-100 dark:bg-amber-900/40', iconColor: 'text-amber-500' },
          { label: 'Ngập nặng (>30cm)', value: stats['>30cm'] ?? 0, icon: TrendingUp, color: 'bg-red-100 dark:bg-red-900/40', iconColor: 'text-red-500' },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className={cn('grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl', s.color)}>
              <s.icon className={cn('h-5 w-5', s.iconColor)} />
            </div>
            <div>
              <div className="text-xs text-slate-400 dark:text-slate-500">{s.label}</div>
              <div className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">{s.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Main layout: table + filter ── */}
      <div className="grid grid-cols-12 gap-4">

        {/* Table */}
        <div className="col-span-12 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 lg:col-span-8">

          {/* Table header */}
          <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-extrabold text-slate-900 dark:text-slate-100">
                {t('reports.predictionData')}
              </div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {rows.length} báo cáo {hasFilters && <span className="ml-1 rounded-full bg-indigo-100 px-1.5 py-0.5 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400">đang lọc</span>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => exportCsv(rows, getLocation)}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                <Download className="h-3.5 w-3.5" /> CSV
              </button>
              <button
                type="button"
                onClick={() => exportExcel(rows, getLocation)}
                className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 shadow-sm hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
              </button>
              <button
                type="button"
                disabled={exporting}
                onClick={async () => { setExporting(true); try { await exportPdf() } finally { setExporting(false) } }}
                className="flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 shadow-sm hover:bg-red-100 disabled:opacity-50 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400"
              >
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
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    <span className="flex items-center gap-1.5"><User className="h-3.5 w-3.5" />Người báo cáo</span>
                  </th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />Khu vực</span>
                  </th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">Mức ngập</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map((r, idx) => (
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
                    {/* User */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <UserAvatar name={r.userFullName} />
                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                          {r.userFullName ?? <span className="italic text-slate-400">Ẩn danh</span>}
                        </span>
                      </div>
                    </td>
                    {/* Location */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-start gap-1.5">
                        <MapPin className="mt-0.5 h-3 w-3 flex-shrink-0 text-slate-400" />
                        <span className="text-xs text-slate-600 dark:text-slate-300 leading-snug">
                          {getLocation(r.latitude, r.longitude)}
                        </span>
                      </div>
                    </td>
                    {/* Level */}
                    <td className="px-4 py-3.5">
                      <LevelBadge level={r.reportedLevel} />
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-16 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <FileText className="h-10 w-10 text-slate-200 dark:text-slate-700" />
                        <div className="text-sm font-semibold text-slate-400 dark:text-slate-500">{t('reports.noData')}</div>
                        {hasFilters && (
                          <div className="text-xs text-slate-400">Thử bỏ bộ lọc để xem toàn bộ dữ liệu</div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination controls */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 dark:border-slate-800">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300"
              >
                ← Trước
              </button>
              <span className="text-xs text-slate-500">
                Trang {pagination.page} / {pagination.totalPages}
              </span>
              <button
                type="button"
                disabled={page >= pagination.totalPages}
                onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300"
              >
                Tiếp →
              </button>
            </div>
          )}
        </div>

        {/* Filter panel */}
        <div className="col-span-12 lg:col-span-4 space-y-4">

          {/* Filter card */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3.5 dark:border-slate-800">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-100 dark:bg-indigo-900/40">
                <Filter className="h-4 w-4 text-indigo-500" />
              </div>
              <div>
                <div className="text-sm font-extrabold text-slate-800 dark:text-slate-100">{t('reports.filters')}</div>
                <div className="text-[11px] text-slate-400">{t('reports.liveFilter')}</div>
              </div>
              {hasFilters && (
                <button
                  type="button"
                  onClick={() => { setDate(''); setDistrictInput(''); setDistrictFilter('') }}
                  className="ml-auto flex items-center gap-1 rounded-lg bg-red-50 px-2 py-1 text-[11px] font-bold text-red-500 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400"
                >
                  <X className="h-3 w-3" /> Xóa
                </button>
              )}
            </div>


            <div className="space-y-4 p-4">
              {/* Date filter */}
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-400">
                  <Calendar className="h-3.5 w-3.5" />{t('reports.date')}
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-indigo-900/40"
                />
              </div>

              {/* District filter */}
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-400">
                  <MapPin className="h-3.5 w-3.5" />{t('reports.district')}
                </label>
                <LocationSearch
                  id="reports-location-search"
                  districts={[]}
                  placeholder={t('floodMap.searchDistrict')}
                  value={districtInput}
                  onChange={setDistrictInput}
                  onFilterChange={setDistrictFilter}
                />
              </div>

              {/* Active filters display */}
              {hasFilters && (
                <div className="space-y-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Đang lọc</div>
                  {date && (
                    <div className="flex items-center gap-2 rounded-lg bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                      <Calendar className="h-3 w-3" /> {new Date(date).toLocaleDateString('vi-VN')}
                    </div>
                  )}
                  {districtFilter && (
                    <div className="flex items-center gap-2 rounded-lg bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                      <MapPin className="h-3 w-3" /> {districtFilter}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Level breakdown card */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="border-b border-slate-100 px-4 py-3.5 dark:border-slate-800">
              <div className="text-sm font-extrabold text-slate-800 dark:text-slate-100">Phân bổ mức ngập</div>
              <div className="text-[11px] text-slate-400">{rows.length} báo cáo trong kết quả hiện tại</div>
            </div>
            <div className="space-y-2 p-4">
              {Object.entries(LEVEL_CONFIG).map(([key, cfg]) => {
                const count = stats[key] ?? 0
                const pct = rows.length ? Math.round((count / rows.length) * 100) : 0
                return (
                  <div key={key}>
                    <div className="mb-1 flex items-center justify-between">
                      <span className={cn('flex items-center gap-1.5 text-xs font-semibold', cfg.text)}>
                        <span className={cn('h-2 w-2 rounded-full', cfg.dot)} />
                        {cfg.label}
                      </span>
                      <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{count} <span className="text-[10px] font-normal">({pct}%)</span></span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className={cn('h-full rounded-full transition-all duration-500', cfg.dot)}
                        style={{ width: `${pct}%` }}
                      />
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
