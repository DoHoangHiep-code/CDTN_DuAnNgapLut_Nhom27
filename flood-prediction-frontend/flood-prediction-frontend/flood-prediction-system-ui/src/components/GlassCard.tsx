import type { HTMLAttributes } from 'react'
import { cn } from '../utils/cn'

export function GlassCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-slate-200/60 bg-white/55 shadow-sm backdrop-blur dark:border-slate-800/60 dark:bg-slate-950/30',
        className,
      )}
      {...props}
    />
  )
}

