import { useMemo, useState, useEffect, useCallback } from 'react'
import {
  Activity, Clock, Terminal, Search, X,
  CheckCircle2, AlertTriangle, XCircle, Info,
  Cpu, Wifi, WifiOff, BarChart3, Filter,
} from 'lucide-react'
import { cn } from '../utils/cn'
import { getSystemLogs } from '../services/api'

// ── Kiểu dữ liệu ────────────────────────────────────────────────────
type LogLevel = 'INFO' | 'WARNING' | 'ERROR' | 'DEBUG'

type LogEntry = {
  ts: string
  level: LogLevel
  source: string   // module phát sinh log
  msg: string
}

// ── Cấu hình hiển thị theo level ────────────────────────────────────
const LEVEL_CONFIG: Record<LogLevel, {
  label: string
  termColor: string       // màu trong terminal
  badgeBg: string         // badge ngoài filter
  badgeText: string
  icon: typeof Info
  dot: string
}> = {
  INFO: {
    label: 'INFO', termColor: 'text-emerald-400',
    badgeBg: 'bg-emerald-950/60', badgeText: 'text-emerald-400',
    icon: Info, dot: 'bg-emerald-400',
  },
  WARNING: {
    label: 'WARN', termColor: 'text-amber-300',
    badgeBg: 'bg-amber-950/60', badgeText: 'text-amber-300',
    icon: AlertTriangle, dot: 'bg-amber-400',
  },
  ERROR: {
    label: 'ERR', termColor: 'text-red-400',
    badgeBg: 'bg-red-950/60', badgeText: 'text-red-400',
    icon: XCircle, dot: 'bg-red-500',
  },
  DEBUG: {
    label: 'DEBUG', termColor: 'text-sky-400',
    badgeBg: 'bg-sky-950/60', badgeText: 'text-sky-400',
    icon: Activity, dot: 'bg-sky-400',
  },
}

// SEED_LOGS removed — using real-time database logs.

// ── Component StatusCard nâng cấp ───────────────────────────────────
function StatusCard({
  icon: Icon, title, value, sub, tone, pulse = false,
}: {
  icon: typeof Activity
  title: string
  value: string
  sub?: string
  tone: 'good' | 'bad' | 'warn' | 'neutral'
  pulse?: boolean
}) {
  const styles = {
    good: {
      card: 'border-emerald-200 bg-emerald-50 dark:border-emerald-800/40 dark:bg-emerald-950/40',
      title: 'text-emerald-700 dark:text-emerald-400',
      value: 'text-emerald-900 dark:text-emerald-300',
      dot: 'bg-emerald-500 dark:bg-emerald-400',
    },
    bad: {
      card: 'border-red-200 bg-red-50 dark:border-red-800/40 dark:bg-red-950/40',
      title: 'text-red-700 dark:text-red-400',
      value: 'text-red-900 dark:text-red-300',
      dot: 'bg-red-500',
    },
    warn: {
      card: 'border-amber-200 bg-amber-50 dark:border-amber-800/40 dark:bg-amber-950/40',
      title: 'text-amber-700 dark:text-amber-400',
      value: 'text-amber-900 dark:text-amber-300',
      dot: 'bg-amber-500 dark:bg-amber-400',
    },
    neutral: {
      card: 'border-slate-200 bg-slate-50 dark:border-slate-700/50 dark:bg-slate-800/50',
      title: 'text-slate-600 dark:text-slate-400',
      value: 'text-slate-900 dark:text-slate-200',
      dot: 'bg-slate-400',
    },
  }
  const s = styles[tone]
  return (
    <div className={cn('relative overflow-hidden rounded-2xl border p-4', s.card)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className={cn('text-[11px] font-bold uppercase tracking-wider', s.title)}>{title}</div>
          <div className={cn('mt-1.5 text-xl font-extrabold tracking-tight', s.value)}>{value}</div>
          {sub && <div className="mt-0.5 text-[10px] text-slate-500">{sub}</div>}
        </div>
        <div className={cn('grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl', s.card)}>
          <Icon className={cn('h-5 w-5', s.title)} />
        </div>
      </div>
      {/* Dot trạng thái có animation pulse khi cần */}
      <div className="mt-3 flex items-center gap-1.5">
        <span className="relative flex h-2 w-2">
          {pulse && <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-75', s.dot)} />}
          <span className={cn('relative inline-flex h-2 w-2 rounded-full', s.dot)} />
        </span>
        <span className="text-[10px] font-semibold text-slate-500">
          {tone === 'good' ? 'Hoạt động bình thường' : tone === 'bad' ? 'Có sự cố' : tone === 'warn' ? 'Cần chú ý' : 'Cập nhật lần cuối'}
        </span>
      </div>
    </div>
  )
}

// ── Component dòng log trong terminal ───────────────────────────────
function LogRow({ entry, query }: { entry: LogEntry; query: string }) {
  const cfg = LEVEL_CONFIG[entry.level]
  const Icon = cfg.icon

  // Highlight từ khớp filter trong message
  function highlight(text: string) {
    if (!query) return <span>{text}</span>
    const idx = text.toLowerCase().indexOf(query.toLowerCase())
    if (idx === -1) return <span>{text}</span>
    return (
      <>
        {text.slice(0, idx)}
        <mark className="rounded bg-yellow-400/30 text-yellow-200">{text.slice(idx, idx + query.length)}</mark>
        {text.slice(idx + query.length)}
      </>
    )
  }

  return (
    <div className="group flex items-start gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-white/5">
      {/* Timestamp */}
      <span className="flex-shrink-0 font-mono text-[11px] text-slate-500 pt-px">{entry.ts}</span>
      {/* Level badge */}
      <span className={cn(
        'mt-px flex-shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-extrabold',
        cfg.badgeBg, cfg.badgeText,
      )}>
        <Icon className="h-2.5 w-2.5" />
        {cfg.label}
      </span>
      {/* Source */}
      <span className="flex-shrink-0 font-mono text-[11px] text-slate-500 pt-px min-w-[72px]">
        [{entry.source}]
      </span>
      {/* Message */}
      <span className="font-mono text-[12px] text-slate-200 leading-5 break-all">
        {highlight(entry.msg)}
      </span>
    </div>
  )
}

// ── Component chính ──────────────────────────────────────────────────
export function AiMonitorLogs() {
  const [filter, setFilter] = useState('')
  const [levelFilter, setLevelFilter] = useState<LogLevel | 'ALL'>('ALL')

  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  // Fetch logs real-time
  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true)
      const data = await getSystemLogs(200) // fetch latest 200 logs

      const mappedLogs: LogEntry[] = data.map((d: any) => {
        const typeStr = (d.event_type || '').toUpperCase()
        const msgStr = (d.message || '').toUpperCase()

        let level: LogLevel = 'INFO'
        if (typeStr.includes('ERR') || msgStr.includes('ERROR') || msgStr.includes('FAIL')) level = 'ERROR'
        else if (typeStr.includes('WARN') || msgStr.includes('WARN')) level = 'WARNING'
        else if (typeStr.includes('DEBUG')) level = 'DEBUG'

        const date = new Date(d.timestamp)
        const ts = date.toLocaleString('vi-VN', {
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        })

        return {
          ts,
          level,
          source: d.event_source || 'System',
          msg: d.message || ''
        }
      })

      setLogs(mappedLogs)
      setLastRefresh(new Date())
    } catch (err) {
      console.error('Failed to fetch logs', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchLogs()
    // Refresh every 5 seconds
    const id = setInterval(fetchLogs, 5000)
    return () => clearInterval(id)
  }, [fetchLogs])

  // Trạng thái hệ thống (giả lập hoặc kết hợp từ logs)
  const modelOnline = true
  const dbConnected = true

  // Lấy thời gian run gần nhất từ các log của AI Worker hoặc Cron
  const cronLogs = logs.filter(l => l.source.toLowerCase().includes('cron') || l.level === 'INFO')
  const lastRunText = cronLogs.length > 0 ? cronLogs[0].ts.split(' ')[1] : '--:--'

  const totalInference = 50

  // Đếm từng level để hiển thị badge filter
  const levelCounts = useMemo(() => {
    const c: Record<string, number> = { INFO: 0, WARNING: 0, ERROR: 0, DEBUG: 0 }
    logs.forEach((l) => { c[l.level] = (c[l.level] ?? 0) + 1 })
    return c
  }, [logs])

  // Lọc log theo level + text search
  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return logs.filter((l) => {
      if (levelFilter !== 'ALL' && l.level !== levelFilter) return false
      if (!q) return true
      return `${l.ts} ${l.level} ${l.source} ${l.msg}`.toLowerCase().includes(q)
    })
  }, [filter, levelFilter, logs])

  const errorCount = levelCounts.ERROR ?? 0
  const warningCount = levelCounts.WARNING ?? 0

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 shadow-lg ring-1 ring-white/10">
            <Terminal className="h-6 w-6 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">AI Monitor & Logs</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Theo dõi trạng thái AI worker, database và toàn bộ log hệ thống.
            </p>
          </div>
        </div>
        {/* Alert tóm tắt nhanh */}
        {(errorCount > 0 || warningCount > 0) && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800/40 dark:bg-amber-950/30">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <span className="text-xs font-bold text-amber-700 dark:text-amber-400">
              {errorCount} lỗi · {warningCount} cảnh báo
            </span>
          </div>
        )}
      </div>

      {/* ── Status cards — nền tối để giống terminal ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatusCard icon={Cpu} title="AI Model" value={modelOnline ? 'Online' : 'Offline'} tone={modelOnline ? 'good' : 'bad'} pulse={modelOnline} />
        <StatusCard icon={dbConnected ? Wifi : WifiOff} title="Database" value={dbConnected ? 'Connected' : 'Disconnected'} tone={dbConnected ? 'good' : 'bad'} pulse={dbConnected} />
        <StatusCard icon={Clock} title="Last Run" value={lastRunText} sub={cronLogs.length > 0 ? cronLogs[0].ts.split(' ')[0] : ''} tone="neutral" />
        <StatusCard icon={BarChart3} title="Tổng inference" value={`${totalInference} nodes`} sub="Chu kỳ gần nhất" tone="neutral" />
      </div>

      {/* ── Terminal ── */}
      <div className="overflow-hidden rounded-2xl border border-slate-700/60 bg-[#0d1117] shadow-2xl">

        {/* Terminal title bar */}
        <div className="flex items-center gap-3 border-b border-white/10 bg-[#161b22] px-4 py-3">
          {/* Nút đèn macOS style */}
          <div className="flex gap-1.5">
            <span className="h-3 w-3 rounded-full bg-red-500/80" />
            <span className="h-3 w-3 rounded-full bg-amber-400/80" />
            <span className="h-3 w-3 rounded-full bg-emerald-500/80" />
          </div>
          <div className="flex-1 text-center text-xs font-semibold text-slate-500">
            flood-prediction-system — logs
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            LIVE
          </div>
        </div>

        {/* Toolbar: filter level + search */}
        <div className="flex flex-wrap items-center gap-2 border-b border-white/5 bg-[#0d1117] px-4 py-2.5">
          <Filter className="h-3.5 w-3.5 text-slate-500 flex-shrink-0" />

          {/* Level filter pills */}
          {(['ALL', 'INFO', 'WARNING', 'ERROR', 'DEBUG'] as const).map((lv) => {
            const active = levelFilter === lv
            const cfg = lv !== 'ALL' ? LEVEL_CONFIG[lv] : null
            const count = lv === 'ALL' ? logs.length : (levelCounts[lv] ?? 0)
            return (
              <button
                key={lv}
                type="button"
                onClick={() => setLevelFilter(lv)}
                className={cn(
                  'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold transition-all',
                  active
                    ? (cfg ? cn(cfg.badgeBg, cfg.badgeText, 'ring-1 ring-current/30') : 'bg-slate-700 text-slate-200')
                    : 'text-slate-500 hover:bg-white/5 hover:text-slate-300',
                )}
              >
                {cfg && <span className={cn('h-1.5 w-1.5 rounded-full', cfg.dot)} />}
                {lv === 'ALL' ? 'ALL' : LEVEL_CONFIG[lv].label}
                <span className="ml-0.5 opacity-60">{count}</span>
              </button>
            )
          })}

          {/* Search */}
          <div className="relative ml-auto">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Tìm trong log..."
              className="w-48 rounded-lg border border-white/10 bg-white/5 py-1.5 pl-8 pr-7 text-[11px] font-mono text-slate-300 placeholder-slate-600 outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30"
            />
            {filter && (
              <button type="button" onClick={() => setFilter('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <span className="text-[10px] text-slate-600 tabular-nums">{rows.length}/{logs.length} dòng</span>
        </div>

        {/* Log lines */}
        <div className="max-h-[420px] overflow-y-auto px-1 py-2 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
          {rows.length > 0 ? (
            rows.map((l, idx) => (
              <LogRow key={`${l.ts}_${idx}`} entry={l} query={filter.trim()} />
            ))
          ) : (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Search className="h-8 w-8 text-slate-700" />
              <div className="text-sm font-semibold text-slate-600">Không có log nào khớp</div>
              <button type="button" onClick={() => { setFilter(''); setLevelFilter('ALL') }} className="text-xs text-emerald-500 hover:underline">
                Xóa bộ lọc
              </button>
            </div>
          )}
        </div>

        {/* Terminal footer */}
        <div className="flex items-center justify-between border-t border-white/5 bg-[#161b22] px-4 py-2">
          <div className="flex items-center gap-3 text-[10px] text-slate-600">
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />{levelCounts.INFO ?? 0} INFO</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" />{levelCounts.WARNING ?? 0} WARN</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-red-500" />{levelCounts.ERROR ?? 0} ERR</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-sky-400" />{levelCounts.DEBUG ?? 0} DEBUG</span>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-slate-600">
            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
            {loading ? 'Đang cập nhật...' : (lastRefresh ? `Cập nhật theo thời gian thực (Lần cuối: ${lastRefresh.toLocaleTimeString()})` : 'Sẵn sàng')}
          </div>
        </div>
      </div>
    </div>
  )
}
