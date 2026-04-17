import { useEffect, useRef, useState } from 'react'
import { X, MapPin, Loader2, Navigation, AlertCircle, CheckCircle2 } from 'lucide-react'
import { cn } from '../utils/cn'
import { Button } from './Button'
import { Input } from './Input'

// ───────────────────────────────────────────────────────────────
// Kiểu dữ liệu
// ───────────────────────────────────────────────────────────────
export type FloodLevel = 'none' | 'low' | 'medium' | 'high'

type Props = {
  open: boolean
  onClose: () => void
  /** Gọi khi người dùng xác nhận gửi báo cáo */
  onSubmit: (payload: { lat: number; lng: number; level: FloodLevel; note: string }) => Promise<void>
}

// Nhãn hiển thị cho mỗi mức độ ngập
const LEVEL_LABELS: Record<FloodLevel, string> = {
  none:   '🟢 Khô ráo (Không ngập)',
  low:    '🟡 Ngập nhẹ (< 15cm)',
  medium: '🟠 Ngập vừa (15 - 30cm)',
  high:   '🔴 Ngập sâu (> 30cm)',
}

// Màu sắc cho badge mức độ
const LEVEL_COLORS: Record<FloodLevel, string> = {
  none:   'bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200',
  low:    'bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200',
  medium: 'bg-orange-100 text-orange-800 ring-orange-200 dark:bg-orange-950/40 dark:text-orange-200',
  high:   'bg-red-100 text-red-800 ring-red-200 dark:bg-red-950/40 dark:text-red-200',
}

// ───────────────────────────────────────────────────────────────
// Component chính
// ───────────────────────────────────────────────────────────────
export function FloodReportModal({ open, onClose, onSubmit }: Props) {
  // ── State vị trí GPS ──
  const [lat, setLat] = useState<number | null>(null)
  const [lng, setLng] = useState<number | null>(null)

  // isLocating = true khi đang chờ GPS phản hồi → hiện spinner trên nút
  const [isLocating, setIsLocating] = useState(false)

  // locationError hiển thị thông báo lỗi dưới nút GPS (đỏ)
  const [locationError, setLocationError] = useState<string | null>(null)

  // ── State form ──
  const [level, setLevel] = useState<FloodLevel>('none')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  // Ref cho input lat/lng thủ công (fallback khi GPS lỗi)
  const latInputRef = useRef<HTMLInputElement>(null)

  // Reset toàn bộ state khi modal đóng/mở lại
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setLat(null)
        setLng(null)
        setIsLocating(false)
        setLocationError(null)
        setLevel('none')
        setNote('')
        setSubmitting(false)
        setSubmitted(false)
      }, 300) // chờ animation đóng xong
    }
  }, [open])

  // Chặn scroll nền khi modal mở
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  // ──────────────────────────────────────────────
  // Hàm lấy vị trí GPS qua HTML5 Geolocation API
  // ──────────────────────────────────────────────
  function handleGetLocation() {
    // Kiểm tra trình duyệt có hỗ trợ Geolocation không
    if (!navigator.geolocation) {
      setLocationError('Trình duyệt của bạn không hỗ trợ định vị GPS.')
      return
    }

    // Bắt đầu định vị → hiện trạng thái loading, xoá lỗi cũ
    setIsLocating(true)
    setLocationError(null)

    navigator.geolocation.getCurrentPosition(
      // ── Callback thành công ──
      (position) => {
        // Lấy tọa độ từ đối tượng GeolocationCoordinates
        const { latitude, longitude } = position.coords

        setLat(latitude)
        setLng(longitude)
        setLocationError(null)   // Xoá thông báo lỗi cũ nếu có
        setIsLocating(false)
      },

      // ── Callback lỗi ──
      (err) => {
        // Phân loại lỗi dựa vào err.code theo chuẩn GeolocationPositionError
        switch (err.code) {
          case 1: // PERMISSION_DENIED
            setLocationError('Bạn đã từ chối cấp quyền vị trí. Vui lòng mở khóa trong cài đặt trình duyệt.')
            break
          case 2: // POSITION_UNAVAILABLE
            setLocationError('Không thể xác định vị trí hiện tại.')
            break
          case 3: // TIMEOUT
            setLocationError('Quá thời gian kết nối GPS.')
            break
          default:
            setLocationError('Lỗi không xác định khi lấy vị trí.')
        }
        setIsLocating(false)
      },

      // ── Options: độ chính xác cao, timeout 10 giây ──
      {
        enableHighAccuracy: true,
        timeout: 10_000,
        maximumAge: 0, // Không dùng cache, luôn lấy vị trí thực tế
      },
    )
  }

  // ── Xử lý gửi báo cáo ──
  async function handleSubmit() {
    if (lat === null || lng === null) {
      setLocationError('Vui lòng lấy vị trí trước khi gửi báo cáo.')
      return
    }

    setSubmitting(true)
    try {
      await onSubmit({ lat, lng, level, note })
      setSubmitted(true)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Không render nếu modal đóng ──
  if (!open) return null

  return (
    // Backdrop mờ – click ra ngoài để đóng
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        
        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
              Báo cáo tình trạng ngập
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Cung cấp vị trí và mức độ ngập lụt thực tế
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="Đóng modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="space-y-5 p-6">

          {/* Trạng thái thành công */}
          {submitted ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <CheckCircle2 className="h-12 w-12 text-emerald-500" />
              <div className="text-base font-bold text-slate-900 dark:text-slate-100">
                Báo cáo đã được gửi!
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Cảm ơn bạn đã đóng góp dữ liệu thực tế.
              </p>
              <Button onClick={onClose} className="mt-2">Đóng</Button>
            </div>
          ) : (
            <>
              {/* ── PHẦN 1: LẤY VỊ TRÍ GPS ── */}
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Vị trí
                </div>

                {/* Nút lấy vị trí GPS */}
                <button
                  type="button"
                  onClick={handleGetLocation}
                  disabled={isLocating}
                  className={cn(
                    'flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-3 text-sm font-semibold transition',
                    isLocating
                      ? 'cursor-not-allowed border-sky-300 bg-sky-50 text-sky-500 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-400'
                      : lat !== null
                        ? 'border-emerald-400 bg-emerald-50 text-emerald-700 hover:border-emerald-500 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                        : 'border-slate-300 bg-slate-50 text-slate-700 hover:border-sky-400 hover:bg-sky-50 hover:text-sky-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
                  )}
                >
                  {/* Hiện spinner khi đang định vị, icon GPS khi ở trạng thái bình thường */}
                  {isLocating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Đang xác định vị trí…
                    </>
                  ) : lat !== null ? (
                    <>
                      <Navigation className="h-4 w-4" />
                      Vị trí đã xác định – Lấy lại
                    </>
                  ) : (
                    <>
                      <MapPin className="h-4 w-4" />
                      Lấy vị trí của tôi
                    </>
                  )}
                </button>

                {/* Hiển thị lỗi GPS (đỏ) ngay dưới nút */}
                {locationError && (
                  <div className="mt-2 flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                    <span>{locationError}</span>
                  </div>
                )}

                {/* Hiển thị tọa độ đã lấy được */}
                {lat !== null && lng !== null && !locationError && (
                  <div className="mt-2 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 dark:bg-emerald-950/30">
                    <Navigation className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span className="font-mono text-xs text-emerald-700 dark:text-emerald-300">
                      {lat.toFixed(6)}, {lng.toFixed(6)}
                    </span>
                  </div>
                )}

                {/* Input thủ công (fallback nếu GPS không khả dụng) */}
                {locationError && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Input
                      ref={latInputRef}
                      label="Vĩ độ (Lat)"
                      placeholder="21.0278"
                      type="number"
                      step="any"
                      value={lat ?? ''}
                      onChange={(e) => setLat(parseFloat(e.target.value) || null)}
                    />
                    <Input
                      label="Kinh độ (Lng)"
                      placeholder="105.8342"
                      type="number"
                      step="any"
                      value={lng ?? ''}
                      onChange={(e) => setLng(parseFloat(e.target.value) || null)}
                    />
                  </div>
                )}
              </div>

              {/* ── PHẦN 2: MỨC ĐỘ NGẬP ── */}
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Mức độ ngập
                </div>
                <div className="flex flex-col gap-2">
                  {(Object.keys(LEVEL_LABELS) as FloodLevel[]).map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => setLevel(lvl)}
                      className={cn(
                        'flex items-center gap-3 rounded-xl border-2 px-4 py-2.5 text-sm font-semibold text-left transition',
                        level === lvl
                          ? cn('border-sky-400 ring-2 ring-sky-100 dark:border-sky-500 dark:ring-sky-900/40', LEVEL_COLORS[lvl])
                          : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800/50',
                      )}
                    >
                      {LEVEL_LABELS[lvl]}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── PHẦN 3: GHI CHÚ ── */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-200">
                  Ghi chú (tuỳ chọn)
                </label>
                <textarea
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Mô tả thêm tình trạng thực tế…"
                  className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-sky-500"
                />
              </div>

              {/* ── NÚT GỬI ── */}
              <div className="flex gap-2 pt-1">
                <Button
                  className="flex-1"
                  onClick={handleSubmit}
                  disabled={submitting || isLocating || lat === null || lng === null}
                >
                  {submitting ? 'Đang gửi…' : 'Gửi báo cáo'}
                </Button>
                <Button variant="ghost" onClick={onClose}>
                  Huỷ
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
