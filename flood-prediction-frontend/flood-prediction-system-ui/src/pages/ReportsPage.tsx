import { useMemo, useState } from 'react'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import toast from 'react-hot-toast'
import { Download, Send } from 'lucide-react'

import { Button } from '../components/Button'
import { CardHeader, CardMeta, CardTitle } from '../components/Card'
import { GlassCard } from '../components/GlassCard'
import { Title3D } from '../components/Title3D'
import { ErrorState } from '../components/ErrorState'
import { Input } from '../components/Input'
import { Spinner } from '../components/Spinner'
import { useAsync } from '../hooks/useAsync'
import { getFloodPrediction, getReports, sendToPowerBI } from '../services/api'
import { LocationSearch } from '../components/LocationSearch'
import type { ReportsResponse } from '../utils/types'
import { useTranslation } from 'react-i18next'

type ActualReportRow = ReportsResponse['rows'][number]

function exportCsv(rows: ActualReportRow[]) {
  const csv = Papa.unparse(
    rows.map((r) => ({
      'Reported At': r.createdAtIso,
      'User Full Name': r.userFullName ?? '',
      Latitude: r.latitude,
      Longitude: r.longitude,
      'Reported Level': r.reportedLevel,
    })),
  )
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `flood-reports-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function exportExcel(rows: ActualReportRow[]) {
  const ws = XLSX.utils.json_to_sheet(
    rows.map((r) => ({
      'Reported At': r.createdAtIso,
      'User Full Name': r.userFullName ?? '',
      Latitude: r.latitude,
      Longitude: r.longitude,
      'Reported Level': r.reportedLevel,
    })),
  )
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Reports')
  XLSX.writeFile(wb, `flood-reports-${new Date().toISOString().slice(0, 10)}.xlsx`)
}

function exportPdf(rows: ActualReportRow[]) {
  const doc = new jsPDF({ orientation: 'landscape' })
  doc.setFontSize(14)
  doc.text('Actual Flood Reports', 14, 14)
  autoTable(doc, {
    startY: 20,
    head: [['Reported At', 'User', 'Latitude', 'Longitude', 'Reported Level']],
    body: rows.map((r) => [r.createdAtIso, r.userFullName ?? '-', String(r.latitude), String(r.longitude), r.reportedLevel]),
    styles: { fontSize: 10 },
    headStyles: { fillColor: [2, 132, 199] },
  })
  doc.save(`flood-reports-${new Date().toISOString().slice(0, 10)}.pdf`)
}

export function ReportsPage() {
  const { t } = useTranslation()
  const [date, setDate] = useState('')
  const [districtInput, setDistrictInput] = useState('')
  const [districtFilter, setDistrictFilter] = useState('')
  const [sending, setSending] = useState(false)

  const flood = useAsync(getFloodPrediction, [])

  const reports = useAsync(
    () => getReports({ date: date || undefined, district: districtFilter || undefined }),
    [date, districtFilter],
  )

  const rows = useMemo(() => reports.data?.rows ?? [], [reports.data])

  if (reports.loading || flood.loading) return <Spinner label="Loading reports…" />
  if (reports.error) return <ErrorState error={reports.error} onRetry={reports.reload} />
  if (flood.error) return <ErrorState error={flood.error} onRetry={flood.reload} />

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
              <div className="text-xs text-slate-500 dark:text-slate-400">{rows.length} rows</div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" leftIcon={<Download className="h-4 w-4" />} onClick={() => exportCsv(rows)}>
                CSV
              </Button>
              <Button size="sm" variant="ghost" leftIcon={<Download className="h-4 w-4" />} onClick={() => exportExcel(rows)}>
                Excel
              </Button>
              <Button size="sm" variant="ghost" leftIcon={<Download className="h-4 w-4" />} onClick={() => exportPdf(rows)}>
                PDF
              </Button>
            </div>
          </div>

          <div className="overflow-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="sticky top-0 bg-white text-xs font-extrabold text-slate-700 dark:bg-slate-900 dark:text-slate-200">
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className="px-4 py-3">{t('reports.date')}</th>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Lat</th>
                  <th className="px-4 py-3">Lng</th>
                  <th className="px-4 py-3">Level</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-950/30">
                    <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
                      {new Date(r.createdAtIso).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{r.userFullName ?? '-'}</td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{r.latitude.toFixed(6)}</td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{r.longitude.toFixed(6)}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-100">
                        {r.reportedLevel}
                      </span>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400" colSpan={5}>
                      {t('reports.noData')}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
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
            districts={flood.data?.districts ?? []}
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

          <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-950/40 dark:text-slate-300">
            <div className="font-semibold">Send to Power BI</div>
            <div className="mt-1">Simulates `POST /api/export-powerbi`</div>
            <div className="mt-3">
              <Button
                leftIcon={<Send className="h-4 w-4" />}
                disabled={sending}
                onClick={async () => {
                  setSending(true)
                  try {
                    const res = await sendToPowerBI({ rows })
                    toast.success(res.message ?? 'Sent to Power BI')
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : 'Failed to send')
                  } finally {
                    setSending(false)
                  }
                }}
              >
                {sending ? 'Sending…' : 'Send to Power BI'}
              </Button>
            </div>
          </div>
        </GlassCard>
      </div>
    </div>
  )
}

