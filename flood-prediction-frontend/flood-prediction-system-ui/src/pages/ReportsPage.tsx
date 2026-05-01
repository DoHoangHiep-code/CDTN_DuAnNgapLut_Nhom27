import { useMemo, useState } from 'react'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import toast from 'react-hot-toast'
import { Download } from 'lucide-react'

import { Button } from '../components/Button'
import { CardHeader, CardMeta, CardTitle } from '../components/Card'
import { GlassCard } from '../components/GlassCard'
import { Title3D } from '../components/Title3D'
import { ErrorState } from '../components/ErrorState'
import { Input } from '../components/Input'
import { Spinner } from '../components/Spinner'
import { useAsync } from '../hooks/useAsync'
import { useReverseGeocode } from '../hooks/useReverseGeocode'
import { getReports } from '../services/api'
import { LocationSearch } from '../components/LocationSearch'
import type { ReportsResponse } from '../utils/types'
import { useTranslation } from 'react-i18next'

type ActualReportRow = ReportsResponse['rows'][number]

// Chuyển ISO string sang múi giờ GMT+7
function toVN(isoStr: string): string {
  return new Date(isoStr).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
}

const LEVEL_STYLES: Record<string, string> = {
  'Khô ráo': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  '<15cm': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  '15-30cm': 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  '>30cm': 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
}

function LevelBadge({ level }: { level: string }) {
  const cls = LEVEL_STYLES[level] ?? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-100'
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${cls}`}>
      {level}
    </span>
  )
}

function exportCsv(rows: ActualReportRow[], getLocation: (lat: number, lng: number) => string) {
  const csv = Papa.unparse(
    rows.map((r) => ({
      'Ngày': toVN(r.createdAtIso),
      'User': r.userFullName ?? '',
      'Khu vực': getLocation(r.latitude, r.longitude),
      'Mức ngập': r.reportedLevel,
    })),
  )
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `flood-reports-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function exportExcel(rows: ActualReportRow[], getLocation: (lat: number, lng: number) => string) {
  const ws = XLSX.utils.json_to_sheet(
    rows.map((r) => ({
      'Ngày': toVN(r.createdAtIso),
      'User': r.userFullName ?? '',
      'Khu vực': getLocation(r.latitude, r.longitude),
      'Mức ngập': r.reportedLevel,
    })),
  )
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

  const coords = useMemo(
    () => rows.map((r) => ({ lat: r.latitude, lng: r.longitude })),
    [rows],
  )
  const { getLocation } = useReverseGeocode(coords)

  if (reports.loading) return <Spinner label="Loading reports…" />
  if (reports.error) return <ErrorState error={reports.error} onRetry={reports.reload} />

  return (
    <div className="space-y-5">
      <div>
        <Title3D>{t('reports.title')}</Title3D>
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('reports.filterHint')}</p>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <GlassCard className="col-span-12 p-0 lg:col-span-8">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-extrabold text-slate-900 dark:text-slate-100">{t('reports.predictionData')}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {rows.length} rows
                {pagination && (
                  <span className="ml-2 text-slate-400">
                    (Trang {pagination.page}/{pagination.totalPages} • Tổng {pagination.total} báo cáo)
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" leftIcon={<Download className="h-4 w-4" />} onClick={() => exportCsv(rows, getLocation)}>
                CSV
              </Button>
              <Button size="sm" variant="ghost" leftIcon={<Download className="h-4 w-4" />} onClick={() => exportExcel(rows, getLocation)}>
                Excel
              </Button>
              <Button
                size="sm"
                variant="ghost"
                leftIcon={<Download className="h-4 w-4" />}
                disabled={exporting}
                onClick={async () => {
                  setExporting(true)
                  try { await exportPdf() } finally { setExporting(false) }
                }}
              >
                {exporting ? 'Đang xuất…' : 'PDF'}
              </Button>
            </div>
          </div>

          <div id="reports-table-container" className="overflow-auto bg-white dark:bg-slate-900">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="sticky top-0 bg-white text-xs font-extrabold text-slate-700 dark:bg-slate-900 dark:text-slate-200">
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className="px-4 py-3">{t('reports.date')}</th>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Khu vực</th>
                  <th className="px-4 py-3">Level</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-950/30">
                    <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
                      {toVN(r.createdAtIso)}
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{r.userFullName ?? '-'}</td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                      {getLocation(r.latitude, r.longitude)}
                    </td>
                    <td className="px-4 py-3">
                      <LevelBadge level={r.reportedLevel} />
                    </td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400" colSpan={4}>
                      {t('reports.noData')}
                    </td>
                  </tr>
                ) : null}
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
        </GlassCard>

        <GlassCard className="col-span-12 h-fit space-y-4 lg:col-span-4">
          <CardHeader>
            <div>
              <CardTitle>{t('reports.filters')}</CardTitle>
              <CardMeta>{t('reports.liveFilter')}</CardMeta>
            </div>
          </CardHeader>

          <Input label={t('reports.date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <LocationSearch
            id="reports-location-search"
            districts={[]}  // Nominatim geo-search mode
            label={t('reports.district')}
            placeholder={t('floodMap.searchDistrict')}
            value={districtInput}
            onChange={setDistrictInput}
            onFilterChange={setDistrictFilter}
          />

          <div className="flex gap-2">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => {
                setDate('')
                setDistrictInput('')
                setDistrictFilter('')
              }}
            >
              {t('reports.clear')}
            </Button>
          </div>

        </GlassCard>
      </div>
    </div>
  )
}
