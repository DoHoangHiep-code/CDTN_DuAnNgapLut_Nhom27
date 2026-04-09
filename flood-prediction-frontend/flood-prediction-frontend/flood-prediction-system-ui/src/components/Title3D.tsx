import type { HTMLAttributes } from 'react'
import { cn } from '../utils/cn'

export function Title3D({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn(
        'text-lg font-extrabold tracking-tight text-slate-900 dark:text-slate-100 drop-shadow-sm',
        className,
      )}
      {...props}
    />
  )
}

