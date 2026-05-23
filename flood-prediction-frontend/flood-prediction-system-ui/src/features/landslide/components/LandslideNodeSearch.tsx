import { useCallback, useEffect, useState } from 'react'
import { Search, X, Loader2, MapPin } from 'lucide-react'
import { useDebounce } from '../../../hooks/useDebounce'
import { cn } from '../../../utils/cn'
import { searchLandslideLocations } from '../../../services/api'
import type { LandslideNode } from '../../../services/api'

export type LandslideNodeSearchProps = {
  placeholder?: string
  value: string
  onChange: (value: string) => void
  onSelectNode?: (node: LandslideNode) => void
  className?: string
  id?: string
}

export function LandslideNodeSearch({
  placeholder = 'Tìm kiếm địa danh, tỉnh thành...',
  value,
  onChange,
  onSelectNode,
  className,
  id = 'landslide-node-search',
}: LandslideNodeSearchProps) {
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [results, setResults] = useState<LandslideNode[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const debounced = useDebounce(value, 500)
  useEffect(() => {
    const query = debounced.trim()

    if (!query || query.length < 2) {
      setResults([])
      return
    }

    setLoading(true)
    setError(false)

    searchLandslideLocations(query, 10)
      .then((nodes) => {
        setResults(nodes)
        setLoading(false)
      })
      .catch(() => {
        setLoading(false)
        setError(true)
      })
  }, [debounced])

  const handleClear = useCallback(() => {
    onChange('')
    setResults([])
    setSuggestOpen(false)
  }, [onChange])

  const showDropdown = suggestOpen && (results.length > 0 || loading || error || (debounced.length >= 2 && results.length === 0))

  return (
    <div className={cn('w-full relative z-[2000]', className)}>
      <div className="relative group">
        {loading ? (
          <Loader2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-orange-500" aria-hidden />
        ) : (
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 group-focus-within:text-orange-500 transition-colors" aria-hidden />
        )}

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
          onBlur={() => window.setTimeout(() => setSuggestOpen(false), 200)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setSuggestOpen(false)
          }}
          placeholder={placeholder}
          className={cn(
            'w-full rounded-full border border-slate-700/50 bg-slate-900/80 py-2.5 pl-10 pr-9 text-sm shadow-xl backdrop-blur-md outline-none transition-all',
            'text-slate-100 placeholder:text-slate-500',
            'focus:border-orange-500/50 focus:bg-slate-900 focus:ring-4 focus:ring-orange-500/10'
          )}
        />

        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
            aria-label="Xoá tìm kiếm"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}

        {showDropdown && (
          <ul
            role="listbox"
            className="absolute left-0 right-0 top-[calc(100%+8px)] mt-1 max-h-72 overflow-y-auto rounded-2xl border border-slate-700/50 bg-slate-900/95 py-2 shadow-2xl backdrop-blur-xl custom-scrollbar"
          >
            {loading && (
              <li className="flex items-center gap-2 px-4 py-3 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin text-orange-500" />
                Đang tìm kiếm...
              </li>
            )}

            {error && !loading && (
              <li className="px-4 py-3 text-sm text-red-400">
                Lỗi khi tìm kiếm dữ liệu.
              </li>
            )}

            {results.length > 0 && !loading && (
              <>
                <li className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Điểm quan trắc Sạt Lở
                </li>
                {results.map((r) => (
                  <li key={r.node_id} role="option">
                    <button
                      type="button"
                      className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-slate-800 transition-colors"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        const displayName = r.location_name || r.province || 'Không tên'
                        onChange(displayName)
                        onSelectNode?.(r)
                        setSuggestOpen(false)
                        setResults([])
                      }}
                    >
                      <div className="flex items-center gap-2.5 overflow-hidden">
                        <MapPin className="h-4 w-4 flex-shrink-0 text-orange-500" />
                        <span className="truncate text-slate-200">
                          {r.location_name ? `${r.location_name}, ${r.province}` : r.province}
                        </span>
                      </div>
                      
                      {r.risk_level === 'DANGER' && <span className="flex-shrink-0 rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-bold text-red-400 border border-red-500/30">NGUY HIỂM</span>}
                      {r.risk_level === 'WARNING' && <span className="flex-shrink-0 rounded bg-orange-500/20 px-1.5 py-0.5 text-[10px] font-bold text-orange-400 border border-orange-500/30">CẢNH BÁO</span>}
                      {r.risk_level === 'SAFE' && <span className="flex-shrink-0 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/30">AN TOÀN</span>}
                    </button>
                  </li>
                ))}
              </>
            )}

            {!loading && !error && results.length === 0 && debounced.length >= 2 && (
              <li className="px-4 py-3 text-sm text-slate-400">
                Không tìm thấy địa điểm nào phù hợp.
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  )
}
