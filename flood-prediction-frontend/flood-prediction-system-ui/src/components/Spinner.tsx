import { cn } from '../utils/cn'

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <div className={cn('flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300', className)}>
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700 dark:border-slate-700 dark:border-t-slate-200" />
      {label ? <span>{label}</span> : null}
    </div>
  )
}

