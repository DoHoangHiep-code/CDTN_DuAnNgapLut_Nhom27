import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { useDebounce } from '../hooks/useDebounce'
import type { FloodDistrict } from '../utils/types'
import { cn } from '../utils/cn'

export type LocationSearchProps = {
  districts: FloodDistrict[]
  placeholder: string
  value: string
  onChange: (value: string) => void
  /** Gọi khi cần lọc (debounce từ gõ + Enter + chọn gợi ý) */
  onFilterChange: (term: string) => void
  /** Khi chọn đúng một quận từ dropdown hoặc Enter khớp địa điểm */
  onSelectDistrict?: (district: FloodDistrict) => void
  label?: string
  className?: string
  id?: string
}

export function LocationSearch({
  districts,
  placeholder,
  value,
  onChange,
  onFilterChange,
  onSelectDistrict,
  label,
  className,
  id = 'location-search',
}: LocationSearchProps) {
  const [suggestOpen, setSuggestOpen] = useState(false)
  const debounced = useDebounce(value, 300)
  const onFilterChangeRef = useRef(onFilterChange)
  onFilterChangeRef.current = onFilterChange

  useEffect(() => {
    onFilterChangeRef.current(debounced.trim())
  }, [debounced])

  const suggestions = useMemo(() => {
    const q = value.trim().toLowerCase()
    if (!q) return []
    return districts.filter((d) => d.name.toLowerCase().includes(q)).slice(0, 8)
  }, [districts, value])

  function commitFilter(term: string) {
    onFilterChange(term.trim())
  }

  function trySelectFromTerm(term: string) {
    const t = term.trim().toLowerCase()
    if (!t || !onSelectDistrict) return
    const exact = districts.find((d) => d.name.toLowerCase() === t)
    if (exact) {
      onSelectDistrict(exact)
      return
    }
    const list = districts.filter((d) => d.name.toLowerCase().includes(t))
    if (list.length === 1) onSelectDistrict(list[0]!)
  }

  return (
    <div className={cn('w-full', className)}>
      {label ? (
        <label htmlFor={id} className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-200">
          {label}
        </label>
      ) : null}
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500"
          aria-hidden
        />
        <input
          id={id}
          type="search"
          value={value}
          autoComplete="off"
          onChange={(e) => {
            onChange(e.target.value)
            setSuggestOpen(true)
          }}
          onFocus={() => setSuggestOpen(true)}
          onBlur={() => window.setTimeout(() => setSuggestOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              const term = value.trim()
              commitFilter(term)
              trySelectFromTerm(term)
              setSuggestOpen(false)
            }
          }}
          placeholder={placeholder}
          className={cn(
            'w-full rounded-2xl border border-slate-200 bg-white/95 py-2.5 pl-10 pr-3 text-sm shadow-sm outline-none backdrop-blur',
            'placeholder:text-slate-500 focus:border-sky-400 focus:ring-2 focus:ring-sky-100',
            'dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-sky-500 dark:focus:ring-sky-900/40',
          )}
        />
        {suggestOpen && suggestions.length > 0 ? (
          <ul
            role="listbox"
            className="absolute left-0 right-0 top-full z-[1100] mt-1 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
          >
            {suggestions.map((d) => (
              <li key={d.id} role="option">
                <button
                  type="button"
                  className="w-full cursor-pointer px-3 py-2 text-left text-sm text-slate-800 hover:bg-sky-50 dark:text-slate-100 dark:hover:bg-slate-800"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange(d.name)
                    commitFilter(d.name)
                    onSelectDistrict?.(d)
                    setSuggestOpen(false)
                  }}
                >
                  {d.name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}
