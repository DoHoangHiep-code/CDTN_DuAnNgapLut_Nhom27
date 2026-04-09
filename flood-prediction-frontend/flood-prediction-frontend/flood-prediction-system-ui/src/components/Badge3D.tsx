import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../utils/cn'

export function Badge3D({
  className,
  children,
  ...props
}: { className?: string; children: ReactNode } & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold shadow-sm ring-1 ring-slate-900/5 backdrop-blur',
        'dark:ring-slate-100/10',
        className,
      )}
      {...props}
    >
      {children}
    </span>
  )
}

