import { memo, useCallback, useRef, useState } from 'react'
import { askExpertChat } from '../../services/expertChatApi'
import { useThinkingSteps, THINKING_STEPS } from '../../hooks/useThinkingSteps'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  /** grid_id của node đang được xem (tuỳ chọn) */
  gridId?: string
  /** Tọa độ tâm bản đồ hiện tại (tuỳ chọn) */
  lat?: number
  lng?: number
  /** CSS class bổ sung cho container ngoài */
  className?: string
}

interface Message {
  id: number
  role: 'user' | 'bot'
  text: string
  riskLevel?: string | null
  depthCm?: number | null
  loading?: boolean
  /** true nếu message là thông báo lỗi – dùng để hiển thị màu cảnh báo thay vì màu bình thường */
  isError?: boolean
}

const RISK_COLOR: Record<string, string> = {
  safe: '#16a34a',
  medium: '#f59e0b',
  high: '#f97316',
  severe: '#e11d48',
}

const QUICK_QUESTIONS = [
  'Vì sao khu vực này có nguy cơ ngập?',
  'Tình trạng ngập hiện tại như thế nào?',
  'Có nên di chuyển qua đây không?',
]

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * ExpertChatbot – Widget chat chuyên gia phân tích ngập lụt.
 *
 * ⚠️ Dùng memo + không giữ ref đến Leaflet map để tránh re-render bản đồ.
 * Chỉ đọc prop gridId/lat/lng từ parent, không subscribe vào map events.
 */
export const ExpertChatbot = memo(function ExpertChatbot({ gridId, lat, lng, className = '' }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 0,
      role: 'bot',
      text: '👋 Xin chào! Tôi là **AQUA Expert Bot**.\n\nHãy hỏi tôi về nguy cơ ngập lụt tại vị trí hiện tại trên bản đồ.\n\nVí dụ: _"Vì sao khu vực này có nguy cơ cao?"_',
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const idRef = useRef(1)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Hook "Thinking" – giả lập các bước xử lý khi chờ AI phản hồi
  const { thinkingText, stepIndex, startThinking, stopThinking } = useThinkingSteps()

  const scrollToBottom = useCallback(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 80)
  }, [])

  const sendMessage = useCallback(
    async (question: string) => {
      const trimmed = question.trim()
      if (!trimmed || loading) return

      const userMsg: Message = { id: idRef.current++, role: 'user', text: trimmed }
      const botPlaceholder: Message = { id: idRef.current++, role: 'bot', text: '', loading: true }

      setMessages((prev) => [...prev, userMsg, botPlaceholder])
      setInput('')
      setLoading(true)
      startThinking()   // ← Bắt đầu chuỗi thinking steps
      scrollToBottom()

      try {
        const res = await askExpertChat({
          question: trimmed,
          grid_id: gridId,
          lat,
          lng,
        })

        setMessages((prev) =>
          prev.map((m) =>
            m.id === botPlaceholder.id
              ? {
                ...m,
                text: res.data.answer,
                riskLevel: res.data.risk_level,
                depthCm: res.data.flood_depth_cm,
                loading: false,
              }
              : m,
          ),
        )
      } catch (err: unknown) {
        // Phân loại lỗi để hiển thị message thân thiện thay vì raw error
        let friendlyText: string
        if (err instanceof Error) {
          // expertChatApi đã xử lý và gắn message thân thiện sẵn
          const isFriendly =
            err.message.includes('Vui lòng thử lại') ||
            err.message.includes('quá tải') ||
            err.message.includes('thời gian khởi động') ||
            err.message.includes('gián đoạn')
          friendlyText = isFriendly
            ? `⚠️ ${err.message}`
            : `⚠️ Hệ thống đang quá tải hoặc model đang cần nhiều thời gian xử lý, vui lòng thử lại sau.`
        } else {
          friendlyText = '⚠️ Đã xảy ra lỗi không xác định. Vui lòng thử lại.'
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botPlaceholder.id
              ? { ...m, text: friendlyText, loading: false, isError: true }
              : m,
          ),
        )
      } finally {
        setLoading(false)
        stopThinking()  // ← Dừng và reset thinking steps
        scrollToBottom()
      }
    },
    [loading, gridId, lat, lng, scrollToBottom],
  )

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    sendMessage(input)
  }

  return (
    <div
      className={`flex flex-col rounded-2xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900 ${className}`}
      style={{ minHeight: 340, maxHeight: 540 }}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 rounded-t-2xl border-b border-slate-100 bg-gradient-to-r from-sky-600 to-blue-700 px-4 py-3 dark:border-slate-700">
        <span className="text-xl">🌊</span>
        <div>
          <p className="text-sm font-bold text-white">AQUA Expert Bot</p>
          <p className="text-[10px] text-sky-200">Phân tích nguy cơ ngập · AI + Rule-based</p>
        </div>
        {(gridId || lat) && (
          <span className="ml-auto rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold text-white">
            {gridId ?? `${lat?.toFixed(3)}, ${lng?.toFixed(3)}`}
          </span>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm ${msg.role === 'user'
                  ? 'bg-sky-600 text-white'
                  : msg.isError
                    ? 'bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-800'
                    : 'bg-slate-50 text-slate-800 dark:bg-slate-800 dark:text-slate-100'
                }`}
            >
              {msg.loading ? (
                // ── Thinking animation – cycling text + progress dots ──────────
                <div className="space-y-2">
                  {/* Dòng text đang hoạt động – thay đổi theo thời gian */}
                  <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-sky-500 border-t-transparent flex-shrink-0" />
                    <span className="text-xs font-medium animate-pulse">{thinkingText}</span>
                  </div>
                  {/* Thanh tiến độ mini dựa trên stepIndex */}
                  <div className="flex gap-1">
                    {THINKING_STEPS.map((_, i) => (
                      <div
                        key={i}
                        className={`h-1 flex-1 rounded-full transition-all duration-500 ${i <= stepIndex ? 'bg-sky-500' : 'bg-slate-200 dark:bg-slate-700'
                          }`}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {/* Render xuống dòng giữ nguyên */}
                  <pre className="whitespace-pre-wrap font-sans">{msg.text}</pre>
                  {/* Risk badge */}
                  {msg.riskLevel && msg.riskLevel !== 'unknown' && (
                    <div className="mt-2 flex items-center gap-2">
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
                        style={{ backgroundColor: RISK_COLOR[msg.riskLevel] ?? '#64748b' }}
                      >
                        {msg.riskLevel.toUpperCase()}
                      </span>
                      {msg.depthCm != null && (
                        <span className="text-[10px] text-slate-500 dark:text-slate-400">
                          {msg.depthCm.toFixed(1)} cm
                        </span>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Quick questions */}
      <div className="flex gap-1.5 overflow-x-auto px-4 pb-2 pt-1">
        {QUICK_QUESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => sendMessage(q)}
            disabled={loading}
            className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-600 transition hover:bg-sky-50 hover:text-sky-700 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 border-t border-slate-100 px-3 py-2.5 dark:border-slate-700"
      >
        <input
          id="expert-chat-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
          placeholder="Hỏi về nguy cơ ngập tại đây…"
          maxLength={500}
          className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
        <button
          id="expert-chat-submit"
          type="submit"
          disabled={loading || !input.trim()}
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-600 text-white transition hover:bg-sky-700 active:scale-95 disabled:opacity-50"
        >
          {loading ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.926A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086l-1.414 4.926a.75.75 0 0 0 .826.95 28.897 28.897 0 0 0 15.293-7.155.75.75 0 0 0 0-1.114A28.897 28.897 0 0 0 3.105 2.288Z" />
            </svg>
          )}
        </button>
      </form>
    </div>
  )
})
