import { useMemo, useState } from 'react'

type LogLevel = 'INFO' | 'WARNING' | 'ERROR'

const LEVEL_COLOR: Record<LogLevel, string> = {
  INFO: 'text-green-400',
  WARNING: 'text-yellow-300',
  ERROR: 'text-red-400',
}

const SEED_LOGS: Array<{ ts: string; level: LogLevel; msg: string }> = [
  { ts: '2026-03-27 09:12:10', level: 'INFO', msg: 'AI worker started. Model loaded: flood-predict-v2' },
  { ts: '2026-03-27 09:12:12', level: 'INFO', msg: 'DB connected. Pool size=10' },
  { ts: '2026-03-27 09:15:02', level: 'WARNING', msg: 'Slow query detected: /api/flood-prediction (742ms)' },
  { ts: '2026-03-27 09:16:25', level: 'INFO', msg: 'Inference completed. districts=30, runtime=183ms' },
  { ts: '2026-03-27 09:17:41', level: 'ERROR', msg: 'Upstream weather provider timeout after 15000ms' },
]

function StatusCard({ title, value, tone }: { title: string; value: string; tone: 'good' | 'bad' | 'neutral' }) {
  const toneCls =
    tone === 'good'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-100'
      : tone === 'bad'
        ? 'border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-950/25 dark:text-red-100'
        : 'border-slate-200 bg-white text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100'

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${toneCls}`}>
      <div className="text-xs font-bold opacity-80">{title}</div>
      <div className="mt-1 text-lg font-extrabold">{value}</div>
    </div>
  )
}

export function AiMonitorLogs() {
  const [filter, setFilter] = useState('')

  const modelOnline = true
  const dbConnected = true
  const lastRun = '2026-03-27 09:16:25'

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return SEED_LOGS
    return SEED_LOGS.filter((l) => `${l.ts} ${l.level} ${l.msg}`.toLowerCase().includes(q))
  }, [filter])

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-extrabold tracking-tight text-slate-900 dark:text-slate-100">AI Monitor & Logs</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">Admin-only monitoring dashboard (UI mock).</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatusCard title="AI Model Status" value={modelOnline ? 'Online' : 'Offline'} tone={modelOnline ? 'good' : 'bad'} />
        <StatusCard title="Database Connection" value={dbConnected ? 'Connected' : 'Disconnected'} tone={dbConnected ? 'good' : 'bad'} />
        <StatusCard title="Last Run Time" value={lastRun} tone="neutral" />
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
          <div className="text-xs font-extrabold text-slate-800 dark:text-slate-100">Terminal Logs</div>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter logs..."
            className="w-56 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 outline-none focus:border-sky-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>

        <div className="bg-[#1e1e1e] p-3 font-mono text-[12px] leading-5">
          {rows.length ? (
            rows.map((l, idx) => (
              <div key={`${l.ts}_${idx}`} className="whitespace-pre-wrap">
                <span className="text-slate-300">[{l.ts}]</span>{' '}
                <span className={LEVEL_COLOR[l.level] ?? 'text-slate-200'}>{l.level}</span>{' '}
                <span className="text-slate-100">{l.msg}</span>
              </div>
            ))
          ) : (
            <div className="text-slate-400">No logs match your filter.</div>
          )}
        </div>
      </div>
    </div>
  )
}

