import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { Search, X, Loader2, MapPin } from 'lucide-react'
import { useDebounce } from '../hooks/useDebounce'
import type { FloodDistrict } from '../utils/types'
import { cn } from '../utils/cn'

// ───────────────────────────────────────────────────────────────
// Kiểu dữ liệu trả về từ Nominatim API
// ───────────────────────────────────────────────────────────────
export type NominatimResult = {
  place_id: number
  display_name: string
  lat: string
  lon: string
  type: string
  class: string
}

// ───────────────────────────────────────────────────────────────
// Props của component
// ───────────────────────────────────────────────────────────────
export type LocationSearchProps = {
  districts: FloodDistrict[]
  placeholder: string
  value: string
  onChange: (value: string) => void
  /** Gọi khi cần lọc marker trên bản đồ nội bộ (debounce) */
  onFilterChange: (term: string) => void
  /** Khi chọn quận nội bộ từ dữ liệu flood */
  onSelectDistrict?: (district: FloodDistrict) => void
  /** Khi chọn địa điểm từ kết quả Nominatim → flyTo tọa độ thật */
  onSelectGeoResult?: (result: NominatimResult) => void
  label?: string
  className?: string
  id?: string
}

// ───────────────────────────────────────────────────────────────
// Hằng số Nominatim
// viewbox giới hạn tìm trong vùng Hà Nội để tăng độ chính xác:
//   Tây: 105.28  Bắc: 21.39  Đông: 106.02  Nam: 20.81
// ───────────────────────────────────────────────────────────────
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const HANOI_VIEWBOX = '105.28,21.39,106.02,20.81'

async function fetchGeoResults(query: string): Promise<NominatimResult[]> {
  // Thêm header User-Agent theo yêu cầu của Nominatim Usage Policy
  const res = await axios.get<NominatimResult[]>(NOMINATIM_URL, {
    params: {
      format: 'json',
      q: query,
      viewbox: HANOI_VIEWBOX,
      bounded: 1,          // Chỉ trả kết quả trong viewbox
      limit: 8,            // Tối đa 8 kết quả để dropdown gọn
      addressdetails: 0,
    },
    headers: {
      'Accept-Language': 'vi,en',
      // User-Agent bắt buộc theo chính sách Nominatim
      'User-Agent': 'FloodPredictionSystem/1.0 (student-project)',
    },
  })
  return res.data
}

// ───────────────────────────────────────────────────────────────
// Component chính
// ───────────────────────────────────────────────────────────────
export function LocationSearch({
  districts,
  placeholder,
  value,
  onChange,
  onFilterChange,
  onSelectDistrict,
  onSelectGeoResult,
  label,
  className,
  id = 'location-search',
}: LocationSearchProps) {
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [geoResults, setGeoResults] = useState<NominatimResult[]>([])
  const [geoLoading, setGeoLoading] = useState(false)
  const [geoError, setGeoError] = useState(false)

  // Debounce 500ms để tránh spam Nominatim API
  const debounced = useDebounce(value, 500)

  // Ref giữ onFilterChange ổn định để tránh re-run useEffect không cần thiết
  const onFilterChangeRef = useRef(onFilterChange)
  onFilterChangeRef.current = onFilterChange

  // AbortController để huỷ request cũ khi người dùng gõ tiếp
  const abortRef = useRef<AbortController | null>(null)

  // ── Tìm kiếm nội bộ trong danh sách quận flood (không cần API) ──
  const localSuggestions = useMemo(() => {
    const q = value.trim().toLowerCase()
    if (!q) return []
    return districts.filter((d) => d.name.toLowerCase().includes(q)).slice(0, 5)
  }, [districts, value])

  // ── Đồng bộ filterTerm (cho CircleMarker) với debounce ──
  useEffect(() => {
    onFilterChangeRef.current(debounced.trim())
  }, [debounced])

  // ── Gọi Nominatim khi debounced query thay đổi ──
  useEffect(() => {
    const query = debounced.trim()

    // Không gọi nếu query rỗng hoặc quá ngắn
    if (!query || query.length < 2) {
      setGeoResults([])
      return
    }

    // Huỷ request trước nếu còn đang chạy
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setGeoLoading(true)
    setGeoError(false)

    fetchGeoResults(query)
      .then((results) => {
        setGeoResults(results)
        setGeoLoading(false)
      })
      .catch((err) => {
        // Bỏ qua lỗi do abort (người dùng gõ tiếp)
        if (axios.isCancel(err)) return
        setGeoLoading(false)
        setGeoError(true)
      })
  }, [debounced])

  // ── Cleanup khi unmount ──
  useEffect(() => () => abortRef.current?.abort(), [])

  // ── Xử lý chọn quận nội bộ ──
  function commitFilter(term: string) {
    onFilterChange(term.trim())
  }

  function trySelectFromTerm(term: string) {
    const t = term.trim().toLowerCase()
    if (!t || !onSelectDistrict) return
    const exact = districts.find((d) => d.name.toLowerCase() === t)
    if (exact) { onSelectDistrict(exact); return }
    const list = districts.filter((d) => d.name.toLowerCase().includes(t))
    if (list.length === 1) onSelectDistrict(list[0]!)
  }

  // ── Reset toàn bộ ──
  const handleClear = useCallback(() => {
    onChange('')
    onFilterChange('')
    setGeoResults([])
    setSuggestOpen(false)
  }, [onChange, onFilterChange])

  // ── Gộp kết quả: quận nội bộ trước, sau đó Nominatim ──
  const hasSuggestions = localSuggestions.length > 0 || geoResults.length > 0
  const showDropdown = suggestOpen && (hasSuggestions || geoLoading || geoError)

  return (
    <div className={cn('w-full', className)}>
      {label ? (
        <label htmlFor={id} className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-200">
          {label}
        </label>
      ) : null}

      <div className="relative">

        {/* Icon tìm kiếm hoặc loading spinner */}
        {geoLoading ? (
          <Loader2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-sky-500" aria-hidden />
        ) : (
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" aria-hidden />
        )}

        {/* Input tìm kiếm */}
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
          // Delay 150ms để cho phép click vào dropdown trước khi đóng
          onBlur={() => window.setTimeout(() => setSuggestOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              const term = value.trim()
              commitFilter(term)
              trySelectFromTerm(term)
              setSuggestOpen(false)
            }
            if (e.key === 'Escape') {
              setSuggestOpen(false)
            }
          }}
          placeholder={placeholder}
          className={cn(
            'w-full rounded-2xl border border-slate-200 bg-white/95 py-2.5 pl-10 pr-9 text-sm shadow-sm outline-none backdrop-blur transition-shadow',
            'placeholder:text-slate-500 focus:border-sky-400 focus:ring-2 focus:ring-sky-100',
            'dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-sky-500 dark:focus:ring-sky-900/40',
          )}
        />

        {/* Nút xoá nội dung - chỉ hiện khi có giá trị */}
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="Xoá tìm kiếm"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        {/* Dropdown gợi ý */}
        {showDropdown && (
          <ul
            role="listbox"
            className="absolute left-0 right-0 top-full z-[1100] mt-1 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
          >
            {/* Trạng thái đang tìm */}
            {geoLoading && (
              <li className="flex items-center gap-2 px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Đang tìm kiếm…
              </li>
            )}

            {/* Trạng thái lỗi */}
            {geoError && !geoLoading && (
              <li className="px-3 py-2 text-xs text-red-500 dark:text-red-400">
                Không thể kết nối Nominatim. Kiểm tra mạng và thử lại.
              </li>
            )}

            {/* ── Quận nội bộ (từ dữ liệu flood) ── */}
            {localSuggestions.length > 0 && (
              <>
                <li className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                  Quận / Huyện trong hệ thống
                </li>
                {localSuggestions.map((d) => (
                  <li key={`local_${d.id}`} role="option">
                    <button
                      type="button"
                      className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-slate-800 hover:bg-sky-50 dark:text-slate-100 dark:hover:bg-slate-800"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        onChange(d.name)
                        commitFilter(d.name)
                        onSelectDistrict?.(d)
                        setSuggestOpen(false)
                      }}
                    >
                      {/* Icon vùng ngập */}
                      <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full bg-sky-500" />
                      <span className="font-medium">{d.name}</span>
                    </button>
                  </li>
                ))}
              </>
            )}

            {/* ── Kết quả từ Nominatim ── */}
            {geoResults.length > 0 && !geoLoading && (
              <>
                <li className="border-t border-slate-100 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:border-slate-800 dark:text-slate-500">
                  Địa điểm (OpenStreetMap)
                </li>
                {geoResults.map((r) => (
                  <li key={`geo_${r.place_id}`} role="option">
                    <button
                      type="button"
                      className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-slate-800 hover:bg-sky-50 dark:text-slate-100 dark:hover:bg-slate-800"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        // Hiển thị tên ngắn (trước dấu phẩy đầu tiên) trong input
                        const shortName = r.display_name.split(',')[0]!
                        onChange(shortName)
                        commitFilter('')
                        onSelectGeoResult?.(r)
                        setSuggestOpen(false)
                        setGeoResults([])
                      }}
                    >
                      <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-rose-500" />
                      <span className="line-clamp-2 leading-tight">
                        {r.display_name}
                      </span>
                    </button>
                  </li>
                ))}
              </>
            )}

            {/* Không có kết quả */}
            {!geoLoading && !geoError && !hasSuggestions && value.trim().length >= 2 && (
              <li className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                Không tìm thấy địa điểm nào.
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  )
}
