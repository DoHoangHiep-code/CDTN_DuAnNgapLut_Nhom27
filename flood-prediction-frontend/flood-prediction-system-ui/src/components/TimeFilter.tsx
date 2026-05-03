import { useEffect, useState } from 'react'
import { apiV1 } from '../utils/axiosConfig'

interface TimeFilterProps {
  onTimeChange: (time: string | null) => void
  selectedTime: string | null
}

export function TimeFilter({ onTimeChange, selectedTime }: TimeFilterProps) {
  const [availableTimes, setAvailableTimes] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [isOpen, setIsOpen] = useState(false)

  // Fetch available prediction times on mount
  useEffect(() => {
    const fetchAvailableTimes = async () => {
      try {
        setLoading(true)
        const res = await apiV1.get<any>('/flood-prediction/available-times')
        const times = (res.data?.data?.times ?? res.data?.times ?? []).sort()
        setAvailableTimes(times)
      } catch (err) {
        console.warn('[TimeFilter] Failed to fetch available times:', err)
        // Fallback: generate next 12 hours as example
        const now = new Date()
        const times: string[] = []
        for (let i = 0; i <= 12; i++) {
          const time = new Date(now.getTime() + i * 3600000)
          times.push(time.toISOString())
        }
        setAvailableTimes(times)
      } finally {
        setLoading(false)
      }
    }
    fetchAvailableTimes()
  }, [])

  const handleTimeSelect = (time: string) => {
    onTimeChange(time)
    setIsOpen(false)
  }

  const handleReset = () => {
    onTimeChange(null)
    setIsOpen(false)
  }

  const formatTime = (isoString: string) => {
    try {
      const date = new Date(isoString)
      return date.toLocaleString('vi-VN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return isoString
    }
  }

  const currentLabel = selectedTime ? formatTime(selectedTime) : 'Thời gian hiện tại'

  return (
    <div className="relative">
      {/* ── Time picker button ── */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 transition"
      >
        <span>🕐</span>
        <span className="hidden sm:inline">{currentLabel}</span>
        <span className="sm:hidden">{selectedTime ? 'Được chọn' : 'Thời gian'}</span>
      </button>

      {/* ── Dropdown menu ── */}
      {isOpen && (
        <div className="absolute top-full mt-2 left-0 z-[2000] w-64 rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <div className="max-h-64 overflow-y-auto">
            {/* Current time option */}
            <button
              type="button"
              onClick={handleReset}
              className={`w-full px-4 py-2 text-left text-xs transition ${
                !selectedTime
                  ? 'bg-blue-100 text-blue-700 font-semibold dark:bg-blue-900/30 dark:text-blue-300'
                  : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              ✓ Thời gian hiện tại
            </button>

            {/* Available times */}
            {loading ? (
              <div className="px-4 py-2 text-xs text-slate-500">Đang tải...</div>
            ) : availableTimes.length === 0 ? (
              <div className="px-4 py-2 text-xs text-slate-500">Không có dữ liệu dự báo</div>
            ) : (
              availableTimes.map((time) => (
                <button
                  key={time}
                  type="button"
                  onClick={() => handleTimeSelect(time)}
                  className={`w-full px-4 py-2 text-left text-xs transition ${
                    selectedTime === time
                      ? 'bg-blue-100 text-blue-700 font-semibold dark:bg-blue-900/30 dark:text-blue-300'
                      : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
                  }`}
                >
                  {formatTime(time)}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* ── Click outside to close ── */}
      {isOpen && (
        <div
          className="fixed inset-0 z-[1999]"
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  )
}
