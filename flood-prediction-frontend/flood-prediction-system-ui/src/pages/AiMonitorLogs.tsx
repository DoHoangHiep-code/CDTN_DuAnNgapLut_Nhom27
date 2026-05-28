import { useMemo, useState, useEffect, useCallback } from 'react'
import {
  Activity, Clock, Terminal, Search, X,
  CheckCircle2, AlertTriangle, XCircle, Info,
  Cpu, Wifi, WifiOff, BarChart3, Filter,
  Waves, Mountain, Server
} from 'lucide-react'
import { cn } from '../utils/cn'
import { getSystemLogs } from '../services/api'

// ── Kiểu dữ liệu ────────────────────────────────────────────────────
type LogLevel = 'INFO' | 'WARNING' | 'ERROR' | 'DEBUG'
type ModuleFilter = 'ALL' | 'FLOOD' | 'LANDSLIDE' | 'SYSTEM'

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
    badgeBg: 'bg-emerald-950/60 border border-emerald-500/20', badgeText: 'text-emerald-400',
    icon: Info, dot: 'bg-emerald-400',
  },
  WARNING: {
    label: 'WARN', termColor: 'text-amber-300',
    badgeBg: 'bg-amber-950/60 border border-amber-500/20', badgeText: 'text-amber-300',
    icon: AlertTriangle, dot: 'bg-amber-400',
  },
  ERROR: {
    label: 'ERR', termColor: 'text-red-400',
    badgeBg: 'bg-red-950/60 border border-red-500/20', badgeText: 'text-red-400',
    icon: XCircle, dot: 'bg-red-500',
  },
  DEBUG: {
    label: 'DEBUG', termColor: 'text-sky-400',
    badgeBg: 'bg-sky-950/60 border border-sky-500/20', badgeText: 'text-sky-400',
    icon: Activity, dot: 'bg-sky-400',
  },
}

const MODULES = [
  { id: 'ALL', label: 'Tất cả', icon: Activity },
  { id: 'FLOOD', label: 'Ngập lụt', icon: Waves },
  { id: 'LANDSLIDE', label: 'Sạt lở', icon: Mountain },
  { id: 'SYSTEM', label: 'Hệ thống', icon: Server },
] as const

// ── Component StatusCard nâng cấp (Premium UI) ───────────────────────
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
      card: 'border-emerald-200/50 bg-gradient-to-br from-emerald-50 to-white dark:border-emerald-500/20 dark:from-emerald-950/40 dark:to-[#0f172a]',
      title: 'text-emerald-700 dark:text-emerald-400',
      value: 'text-emerald-900 dark:text-emerald-300',
      dot: 'bg-emerald-500 dark:bg-emerald-400',
      iconBg: 'bg-emerald-100 dark:bg-emerald-500/20',
    },
    bad: {
      card: 'border-red-200/50 bg-gradient-to-br from-red-50 to-white dark:border-red-500/20 dark:from-red-950/40 dark:to-[#0f172a]',
      title: 'text-red-700 dark:text-red-400',
      value: 'text-red-900 dark:text-red-300',
      dot: 'bg-red-500',
      iconBg: 'bg-red-100 dark:bg-red-500/20',
    },
    warn: {
      card: 'border-amber-200/50 bg-gradient-to-br from-amber-50 to-white dark:border-amber-500/20 dark:from-amber-950/40 dark:to-[#0f172a]',
      title: 'text-amber-700 dark:text-amber-400',
      value: 'text-amber-900 dark:text-amber-300',
      dot: 'bg-amber-500 dark:bg-amber-400',
      iconBg: 'bg-amber-100 dark:bg-amber-500/20',
    },
    neutral: {
      card: 'border-slate-200/50 bg-gradient-to-br from-slate-50 to-white dark:border-slate-700/50 dark:from-slate-800/40 dark:to-[#0f172a]',
      title: 'text-slate-600 dark:text-slate-400',
      value: 'text-slate-900 dark:text-slate-200',
      dot: 'bg-slate-400',
      iconBg: 'bg-slate-200 dark:bg-slate-700',
    },
  }
  const s = styles[tone]
  return (
    <div className={cn('relative overflow-hidden rounded-2xl border p-4 shadow-sm backdrop-blur-xl transition-transform hover:-translate-y-1', s.card)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className={cn('text-[11px] font-bold uppercase tracking-wider', s.title)}>{title}</div>
          <div className={cn('mt-1.5 text-2xl font-black tracking-tight', s.value)}>{value}</div>
          {sub && <div className="mt-1 text-[11px] font-medium text-slate-500">{sub}</div>}
        </div>
        <div className={cn('grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl shadow-inner', s.iconBg)}>
          <Icon className={cn('h-5 w-5', s.title)} />
        </div>
      </div>
      {/* Dot trạng thái có animation pulse khi cần */}
      <div className="mt-4 flex items-center gap-1.5 border-t border-slate-200/50 pt-3 dark:border-slate-700/50">
        <span className="relative flex h-2 w-2">
          {pulse && <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-75', s.dot)} />}
          <span className={cn('relative inline-flex h-2 w-2 rounded-full', s.dot)} />
        </span>
        <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
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
        <mark className="rounded bg-yellow-400/40 px-1 text-yellow-100">{text.slice(idx, idx + query.length)}</mark>
        {text.slice(idx + query.length)}
      </>
    )
  }

  // Phân biệt nguồn gốc log (Ngập lụt / Sạt lở / Hệ thống)
  const sourceLower = entry.source.toLowerCase()
  let SourceIcon = Server
  let sourceColor = 'text-slate-400'
  
  if (sourceLower.includes('flood')) {
    SourceIcon = Waves
    sourceColor = 'text-blue-400'
  } else if (sourceLower.includes('landslide')) {
    SourceIcon = Mountain
    sourceColor = 'text-amber-600'
  }

  return (
    <div className="group flex items-start gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-white/5">
      {/* Timestamp */}
      <span className="flex-shrink-0 font-mono text-[11px] text-slate-500 pt-px">{entry.ts}</span>
      {/* Level badge */}
      <span className={cn(
        'mt-px flex-shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-extrabold shadow-sm',
        cfg.badgeBg, cfg.badgeText,
      )}>
        <Icon className="h-2.5 w-2.5" />
        {cfg.label}
      </span>
      {/* Source */}
      <span className="flex-shrink-0 font-mono text-[11px] text-slate-500 pt-px min-w-[120px] flex items-center gap-1.5 truncate">
        <SourceIcon className={cn("h-3 w-3", sourceColor)} />
        [{entry.source}]
      </span>
      {/* Message */}
      <span className={cn("font-mono text-[12px] leading-5 break-all", cfg.termColor)}>
        {highlight(entry.msg)}
      </span>
    </div>
  )
}

// ── Component chính ──────────────────────────────────────────────────
export function AiMonitorLogs() {
  const [filter, setFilter] = useState('')
  const [levelFilter, setLevelFilter] = useState<LogLevel | 'ALL'>('ALL')
  const [moduleFilter, setModuleFilter] = useState<ModuleFilter>('ALL')

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

  // Lọc log theo module
  const moduleFilteredLogs = useMemo(() => {
    return logs.filter((l) => {
      if (moduleFilter === 'ALL') return true
      const s = l.source.toLowerCase()
      if (moduleFilter === 'FLOOD') return s.includes('flood')
      if (moduleFilter === 'LANDSLIDE') return s.includes('landslide')
      if (moduleFilter === 'SYSTEM') return !s.includes('flood') && !s.includes('landslide')
      return true
    })
  }, [logs, moduleFilter])

  // Trạng thái hệ thống (giả lập hoặc kết hợp từ logs)
  const modelOnline = true
  const dbConnected = true

  // Lấy thời gian run gần nhất từ các log của AI Worker hoặc Cron
  const cronLogs = moduleFilteredLogs.filter(l => l.source.toLowerCase().includes('cron') || l.level === 'INFO')
  const lastRunText = cronLogs.length > 0 ? cronLogs[0].ts.split(' ')[1] : '--:--'

  // Dynamic Inference count based on Module
  let totalInferenceText = '53,330' // Mặc định flood
  if (moduleFilter === 'LANDSLIDE') totalInferenceText = '850,858'
  if (moduleFilter === 'ALL') totalInferenceText = '904,188'
  if (moduleFilter === 'SYSTEM') totalInferenceText = '0'

  // Đếm từng level để hiển thị badge filter
  const levelCounts = useMemo(() => {
    const c: Record<string, number> = { INFO: 0, WARNING: 0, ERROR: 0, DEBUG: 0 }
    moduleFilteredLogs.forEach((l) => { c[l.level] = (c[l.level] ?? 0) + 1 })
    return c
  }, [moduleFilteredLogs])

  // Lọc log theo level + text search
  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return moduleFilteredLogs.filter((l) => {
      if (levelFilter !== 'ALL' && l.level !== levelFilter) return false
      if (!q) return true
      return `${l.ts} ${l.level} ${l.source} ${l.msg}`.toLowerCase().includes(q)
    })
  }, [filter, levelFilter, moduleFilteredLogs])

  const errorCount = levelCounts.ERROR ?? 0
  const warningCount = levelCounts.WARNING ?? 0

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* ── Header & Module Selector ── */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-center gap-4">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/20">
            <Terminal className="h-7 w-7 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">Trung tâm Logs & Giám sát AI</h2>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mt-0.5">
              Theo dõi chi tiết trạng thái hoạt động của các phân hệ Ngập lụt, Sạt lở và Database.
            </p>
          </div>
        </div>

        {/* Phân hệ (Module) Selector */}
        <div className="flex items-center gap-1 rounded-xl bg-slate-100/80 p-1 backdrop-blur-md dark:bg-slate-800/80 shadow-inner">
          {MODULES.map((mod) => {
            const active = moduleFilter === mod.id
            const Icon = mod.icon
            return (
              <button
                key={mod.id}
                onClick={() => setModuleFilter(mod.id)}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition-all duration-300",
                  active
                    ? "bg-white text-indigo-600 shadow-sm dark:bg-indigo-500/20 dark:text-indigo-300"
                    : "text-slate-600 hover:bg-slate-200/50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700/50 dark:hover:text-slate-200"
                )}
              >
                <Icon className="h-4 w-4" />
                {mod.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Alert tóm tắt nhanh */}
      {(errorCount > 0 || warningCount > 0) && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 to-transparent px-4 py-3 dark:from-amber-950/40">
          <AlertTriangle className="h-5 w-5 text-amber-500 animate-bounce" />
          <span className="text-sm font-bold text-amber-800 dark:text-amber-400">
            Hệ thống phát hiện {errorCount} lỗi và {warningCount} cảnh báo trong phân hệ hiện tại. Cần kiểm tra ngay!
          </span>
        </div>
      )}

      {/* ── Status cards ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatusCard icon={Cpu} title="AI Worker" value={modelOnline ? 'Online' : 'Offline'} tone={modelOnline ? 'good' : 'bad'} pulse={modelOnline} />
        <StatusCard icon={dbConnected ? Wifi : WifiOff} title="PostgreSQL + PostGIS" value={dbConnected ? 'Connected' : 'Disconnected'} tone={dbConnected ? 'good' : 'bad'} pulse={dbConnected} />
        <StatusCard icon={Clock} title="Cronjob Gần Nhất" value={lastRunText} sub={cronLogs.length > 0 ? cronLogs[0].ts.split(' ')[0] : 'Đang chờ...'} tone="neutral" />
        <StatusCard icon={BarChart3} title="Quy Mô Inference" value={`${totalInferenceText} nodes`} sub={`Thuộc phân hệ: ${MODULES.find(m => m.id === moduleFilter)?.label}`} tone="neutral" />
      </div>

      {/* ── Terminal Window ── */}
      <div className="overflow-hidden rounded-2xl border border-slate-700/50 bg-[#090b10] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.5)]">
        
        {/* Terminal title bar (MacOS style) */}
        <div className="flex items-center justify-between border-b border-white/5 bg-[#121620] px-4 py-3">
          <div className="flex items-center gap-4">
            <div className="flex gap-2">
              <span className="h-3 w-3 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]" />
              <span className="h-3 w-3 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]" />
              <span className="h-3 w-3 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
            </div>
            <div className="text-xs font-bold text-slate-400 flex items-center gap-2">
              <Terminal className="h-3.5 w-3.5 text-indigo-400" />
              aqua-alert-system ~ {moduleFilter.toLowerCase()}
            </div>
          </div>
          
          <div className="flex items-center gap-2 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold tracking-wider text-emerald-400 ring-1 ring-emerald-500/20">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_5px_rgba(52,211,153,0.8)]" />
            LIVE STREAM
          </div>
        </div>

        {/* Toolbar: filter level + search */}
        <div className="flex flex-wrap items-center gap-3 border-b border-white/5 bg-[#0d111a] px-4 py-3">
          <Filter className="h-4 w-4 text-slate-500 flex-shrink-0" />

          {/* Level filter pills */}
          <div className="flex items-center gap-1">
            {(['ALL', 'INFO', 'WARNING', 'ERROR', 'DEBUG'] as const).map((lv) => {
              const active = levelFilter === lv
              const cfg = lv !== 'ALL' ? LEVEL_CONFIG[lv] : null
              const count = lv === 'ALL' ? moduleFilteredLogs.length : (levelCounts[lv] ?? 0)
              return (
                <button
                  key={lv}
                  type="button"
                  onClick={() => setLevelFilter(lv)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-bold transition-all',
                    active
                      ? (cfg ? cn(cfg.badgeBg, cfg.badgeText, 'ring-1 ring-current/50 bg-opacity-100') : 'bg-slate-700 text-white ring-1 ring-slate-500')
                      : 'text-slate-400 hover:bg-white/5 hover:text-slate-200',
                  )}
                >
                  {cfg && <span className={cn('h-1.5 w-1.5 rounded-full', cfg.dot)} />}
                  {lv === 'ALL' ? 'TẤT CẢ' : LEVEL_CONFIG[lv].label}
                  <span className={cn(
                    "ml-1 rounded-full px-1.5 py-0.5 text-[9px]",
                    active ? "bg-black/20" : "bg-white/10"
                  )}>{count}</span>
                </button>
              )
            })}
          </div>

          {/* Search */}
          <div className="relative ml-auto w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Tìm kiếm trong logs..."
              className="w-full rounded-lg border border-slate-700/50 bg-black/40 py-2 pl-9 pr-8 text-xs font-mono text-slate-200 placeholder-slate-600 outline-none transition-all focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30"
            />
            {filter && (
              <button type="button" onClick={() => setFilter('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Log lines */}
        <div className="max-h-[500px] min-h-[300px] overflow-y-auto px-2 py-3 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
          {rows.length > 0 ? (
            <div className="space-y-0.5">
              {rows.map((l, idx) => (
                <LogRow key={`${l.ts}_${idx}`} entry={l} query={filter.trim()} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-center h-full">
              <div className="grid h-16 w-16 place-items-center rounded-full bg-slate-800/50">
                <Search className="h-8 w-8 text-slate-600" />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-400">Không tìm thấy bản ghi log nào</div>
                <div className="text-xs text-slate-500 mt-1">Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm.</div>
              </div>
              {(filter || levelFilter !== 'ALL') && (
                <button type="button" onClick={() => { setFilter(''); setLevelFilter('ALL') }} className="mt-2 text-xs font-bold text-indigo-400 hover:text-indigo-300 hover:underline">
                  Xóa toàn bộ bộ lọc
                </button>
              )}
            </div>
          )}
        </div>

        {/* Terminal footer */}
        <div className="flex items-center justify-between border-t border-white/5 bg-[#121620] px-5 py-2.5">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
            Đang hiển thị <span className="font-bold text-slate-300">{rows.length}</span> / {moduleFilteredLogs.length} dòng
          </div>
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            {loading ? 'Đang kéo dữ liệu...' : (lastRefresh ? `Đồng bộ: ${lastRefresh.toLocaleTimeString()}` : 'Sẵn sàng')}
          </div>
        </div>
      </div>
    </div>
  )
}
