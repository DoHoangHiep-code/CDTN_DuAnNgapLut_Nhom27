import { useMemo, useState } from 'react'
import {
  Activity, Clock, Terminal, Search, X,
  CheckCircle2, AlertTriangle, XCircle, Info,
  Cpu, Wifi, WifiOff, BarChart3, Filter,
} from 'lucide-react'
import { cn } from '../utils/cn'

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

// ── Dữ liệu log mock (trong thực tế sẽ fetch từ /api/v1/logs) ───────
// Logic: mỗi entry có ts (timestamp), level, source (tên module), msg.
// Source giúp admin biết lỗi đến từ AI worker, DB, cron hay API gateway.
const SEED_LOGS: LogEntry[] = [
  { ts: '2026-04-27 08:00:01', level: 'INFO',    source: 'System',     msg: 'Server khởi động. Node.js v20, port=3002' },
  { ts: '2026-04-27 08:00:03', level: 'INFO',    source: 'Database',   msg: 'Kết nối PostgreSQL thành công. Pool size=10' },
  { ts: '2026-04-27 08:00:05', level: 'INFO',    source: 'AI Worker',  msg: 'Model CatBoost đã tải. flood-predict-v2, features=12' },
  { ts: '2026-04-27 08:01:00', level: 'INFO',    source: 'Cron',       msg: 'WeatherCron bắt đầu chu kỳ fetch dữ liệu thời tiết' },
  { ts: '2026-04-27 08:01:04', level: 'INFO',    source: 'Weather',    msg: 'Fetch thời tiết thành công. 50 node, elapsed=1.2s' },
  { ts: '2026-04-27 08:01:06', level: 'INFO',    source: 'AI Worker',  msg: 'Inference hoàn tất. districts=50, runtime=183ms' },
  { ts: '2026-04-27 08:15:00', level: 'WARNING', source: 'Database',   msg: 'Slow query: /api/flood-prediction (742ms > threshold 500ms)' },
  { ts: '2026-04-27 08:20:11', level: 'INFO',    source: 'API',        msg: 'GET /api/v1/flood-prediction 200 OK (210ms)' },
  { ts: '2026-04-27 08:31:00', level: 'WARNING', source: 'Weather',    msg: 'OpenWeatherMap rate limit gần đạt (85/100 req/min)' },
  { ts: '2026-04-27 08:45:18', level: 'ERROR',   source: 'Weather',    msg: 'Upstream weather provider timeout sau 15000ms. Dùng cache.' },
  { ts: '2026-04-27 08:45:19', level: 'WARNING', source: 'AI Worker',  msg: 'Inference dùng dữ liệu thời tiết cached (offline mode)' },
  { ts: '2026-04-27 09:00:00', level: 'INFO',    source: 'Cron',       msg: 'WeatherCron chu kỳ mới. Thử lại fetch sau lỗi trước đó.' },
  { ts: '2026-04-27 09:00:03', level: 'INFO',    source: 'Weather',    msg: 'Kết nối khôi phục. Fetch thời tiết thành công.' },
  { ts: '2026-04-27 09:16:25', level: 'INFO',    source: 'AI Worker',  msg: 'Inference hoàn tất. districts=50, runtime=201ms, avg_depth=12.4cm' },
  { ts: '2026-04-27 09:30:00', level: 'DEBUG',   source: 'Database',   msg: 'Vacuum analyze grid_nodes: 50 rows, elapsed=48ms' },
  { ts: '2026-04-27 09:45:00', level: 'ERROR',   source: 'AI Service', msg: 'Python AI service không phản hồi (port 8000). Retry 1/3...' },
  { ts: '2026-04-27 09:45:02', level: 'ERROR',   source: 'AI Service', msg: 'Retry 2/3 thất bại. Fallback về demoData.' },
  { ts: '2026-04-27 09:45:04', level: 'WARNING', source: 'AI Worker',  msg: 'Dùng demoData vì AI service không khả dụng.' },
  { ts: '2026-04-27 10:00:01', level: 'INFO',    source: 'AI Service', msg: 'Python AI service khôi phục. Kết nối lại thành công.' },
  { ts: '2026-04-27 10:16:25', level: 'INFO',    source: 'AI Worker',  msg: 'Inference bình thường. districts=50, runtime=178ms' },
]

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
    good:    { card: 'border-emerald-800/40 bg-emerald-950/40', title: 'text-emerald-400', value: 'text-emerald-300', dot: 'bg-emerald-400' },
    bad:     { card: 'border-red-800/40 bg-red-950/40',         title: 'text-red-400',     value: 'text-red-300',     dot: 'bg-red-500' },
    warn:    { card: 'border-amber-800/40 bg-amber-950/40',     title: 'text-amber-400',   value: 'text-amber-300',   dot: 'bg-amber-400' },
    neutral: { card: 'border-slate-700/50 bg-slate-800/50',     title: 'text-slate-400',   value: 'text-slate-200',   dot: 'bg-slate-400' },
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
  const [filter, setFilter]     = useState('')
  const [levelFilter, setLevelFilter] = useState<LogLevel | 'ALL'>('ALL')

  // Trạng thái hệ thống (mock — trong thực tế fetch từ /api/v1/system/status)
  const modelOnline  = true
  const dbConnected  = true
  const lastRun      = '2026-04-27 10:16:25'
  const totalInference = 50

  // Đếm từng level để hiển thị badge filter
  const levelCounts = useMemo(() => {
    const c: Record<string, number> = { INFO: 0, WARNING: 0, ERROR: 0, DEBUG: 0 }
    SEED_LOGS.forEach((l) => { c[l.level] = (c[l.level] ?? 0) + 1 })
    return c
  }, [])

  // Lọc log theo level + text search
  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return SEED_LOGS.filter((l) => {
      if (levelFilter !== 'ALL' && l.level !== levelFilter) return false
      if (!q) return true
      return `${l.ts} ${l.level} ${l.source} ${l.msg}`.toLowerCase().includes(q)
    })
  }, [filter, levelFilter])

  const errorCount   = levelCounts.ERROR ?? 0
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
        <StatusCard icon={Cpu}        title="AI Model"      value={modelOnline ? 'Online' : 'Offline'}        tone={modelOnline ? 'good' : 'bad'} pulse={modelOnline} />
        <StatusCard icon={dbConnected ? Wifi : WifiOff} title="Database" value={dbConnected ? 'Connected' : 'Disconnected'} tone={dbConnected ? 'good' : 'bad'} pulse={dbConnected} />
        <StatusCard icon={Clock}      title="Last Run"      value={lastRun.split(' ')[1]}  sub={lastRun.split(' ')[0]}  tone="neutral" />
        <StatusCard icon={BarChart3}  title="Tổng inference" value={`${totalInference} nodes`} sub="Chu kỳ gần nhất" tone="neutral" />
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
            const count = lv === 'ALL' ? SEED_LOGS.length : (levelCounts[lv] ?? 0)
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

          <span className="text-[10px] text-slate-600 tabular-nums">{rows.length}/{SEED_LOGS.length} dòng</span>
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
            Dữ liệu mock — kết nối /api/v1/system/logs để xem log thật
          </div>
        </div>
      </div>
    </div>
  )
}
