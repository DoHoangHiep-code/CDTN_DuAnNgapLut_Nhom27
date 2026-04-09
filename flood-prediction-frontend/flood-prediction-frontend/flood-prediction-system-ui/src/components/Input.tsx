import React from 'react'
import { cn } from '../utils/cn'

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string
  hint?: string
  error?: string
}

export function Input({ label, hint, error, className, ...props }: Props) {
  return (
    <label className="block">
      {label ? <span className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-200">{label}</span> : null}
      <input
        className={cn(
          'h-11 w-full rounded-xl border bg-white px-3 text-sm outline-none transition',
          'border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-sky-400 focus:ring-4 focus:ring-sky-100',
          'dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-sky-500 dark:focus:ring-sky-900/40',
          error ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-100 dark:border-rose-700 dark:focus:ring-rose-900/30' : '',
          className,
        )}
        {...props}
      />
      {error ? (
        <span className="mt-1 block text-xs text-rose-600 dark:text-rose-300">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{hint}</span>
      ) : null}
    </label>
  )
}

