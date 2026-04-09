import React from 'react'
import { cn } from '../utils/cn'

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  leftIcon?: React.ReactNode
}

export function Button({ className, variant = 'primary', size = 'md', leftIcon, children, ...props }: Props) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition',
        'disabled:cursor-not-allowed disabled:opacity-60',
        size === 'sm' ? 'h-9 px-3 text-sm' : 'h-11 px-4 text-sm',
        variant === 'primary' &&
          'bg-sky-600 text-white shadow-sm hover:bg-sky-700 active:bg-sky-800 dark:bg-sky-500 dark:hover:bg-sky-600',
        variant === 'secondary' &&
          'bg-slate-900 text-white hover:bg-slate-800 active:bg-slate-950 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white',
        variant === 'ghost' &&
          'bg-transparent text-slate-700 hover:bg-slate-100 active:bg-slate-200 dark:text-slate-200 dark:hover:bg-slate-800 dark:active:bg-slate-700',
        variant === 'danger' &&
          'bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800 dark:bg-rose-500 dark:hover:bg-rose-600',
        className,
      )}
      {...props}
    >
      {leftIcon ? <span className="text-base">{leftIcon}</span> : null}
      {children}
    </button>
  )
}

