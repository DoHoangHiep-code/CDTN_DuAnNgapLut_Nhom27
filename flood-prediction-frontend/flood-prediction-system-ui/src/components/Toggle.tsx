import { cn } from '../utils/cn'

type Props = {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  hint?: string
}

export function Toggle({ label, checked, onChange, hint }: Props) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{label}</div>
        {hint ? <div className="text-xs text-slate-500 dark:text-slate-400">{hint}</div> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-7 w-12 rounded-full transition',
          checked ? 'bg-sky-600 dark:bg-sky-500' : 'bg-slate-300 dark:bg-slate-700',
        )}
      >
        <span
          className={cn(
            'absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition',
            checked ? 'left-6' : 'left-1',
          )}
        />
      </button>
    </div>
  )
}

