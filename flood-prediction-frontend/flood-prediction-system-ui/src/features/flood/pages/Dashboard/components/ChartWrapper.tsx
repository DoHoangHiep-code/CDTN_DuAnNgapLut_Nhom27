import { useEffect, useRef, useState } from 'react'

type Size = { width: number; height: number }

/**
 * Measures container size via ResizeObserver and injects it into children
 * via a render-prop, replacing ResponsiveContainer entirely.
 *
 * Why: ResponsiveContainer fires a Recharts warning on every render where
 * the DOM hasn't been laid out yet (width/height = -1). Passing explicit
 * numeric width/height only after the first positive measurement eliminates
 * the warning at the source.
 */
export function ChartWrapper({
  children,
  className = 'h-full w-full',
}: {
  children: (size: Size) => React.ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<Size | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      if (width > 0 && height > 0) {
        setSize({ width: Math.floor(width), height: Math.floor(height) })
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref} className={className}>
      {size && children(size)}
    </div>
  )
}
