import { useEffect, useRef, useState } from 'react'
import { Send, Bot, User, X, Droplets } from 'lucide-react'
import { askChatbot as askChatbotApi, callExpertDetail as callExpertDetailApi } from '../../services/expertChatApi'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  id: string
  role: 'user' | 'bot'
  text: string
  ts: Date
  expertNodes?: Array<{ node_id: string; location_name: string; risk_level: string }>
  suggestAreas?: boolean
  areaKeywords?: string[]
  area?: string
  actionButton?: { label: string; payload: string }
}

interface Props {
  onClose: () => void
}

// ─── Hàm helper thuần (không dùng state/ref) – đặt ngoài component là đúng ──

async function askChatbot(
  question: string
): Promise<{ reply: string; expertNodes?: any[]; suggestAreas?: boolean; areaKeywords?: string[]; area?: string; actionButton?: { label: string; payload: string } }> {
  try {
    const res = await askChatbotApi(question)
    if (!res.success) throw new Error(res.error?.message ?? 'Không có phản hồi.')

    // Backend mới trả các field ở top-level (reply, intent, expertNodes…).
    // Backend cũ bọc trong res.data. Đọc top-level trước, fallback về res.data nếu cần.
    const reply        = res.reply        ?? res.data?.reply        ?? ''
    const expertNodes  = res.expertNodes  ?? res.data?.expertNodes
    const suggestAreas = res.suggestAreas ?? res.data?.suggestAreas
    const areaKeywords = res.areaKeywords ?? res.data?.areaKeywords
    const area         = res.area         ?? res.data?.area
    const actionButton = res.actionButton ?? res.data?.actionButton

    if (!reply) throw new Error('Không nhận được phản hồi từ chatbot.')

    return { reply, expertNodes, suggestAreas, areaKeywords, area, actionButton }
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'response' in err) {
      const axiosErr = err as { response?: { data?: unknown; status?: number } }
      console.error('[Chatbot] Lỗi từ Backend:', axiosErr.response?.status, axiosErr.response?.data)
    }
    throw err
  }
}

/** Render **bold** text đơn giản */
function renderText(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={i}>{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>
  )
}

// ─── Component chính ──────────────────────────────────────────────────────────

export function ChatInterface({ onClose }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'bot',
      text: 'Xin chào! Tôi là trợ lý AI của hệ thống **AquaAlert**. Bạn có thể hỏi tôi về tình trạng ngập lụt, dự báo mưa, khu vực nguy hiểm, hoặc các lời khuyên an toàn. 💧',
      ts: new Date(),
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // ── Các hàm dùng state/ref → phải nằm BÊN TRONG component ────────────────

  /** Render danh sách nút "Xem phân tích AI" cho từng node */
  function renderExpertNodes(
    nodes: Array<{ node_id: string; location_name: string; risk_level: string }>,
    originalQuestion: string
  ) {
    return (
      <div className="flex flex-col gap-2">
        {nodes.map((node) => (
          <button
            key={node.node_id}
            type="button"
            onClick={() => void handleExpertDetailClick(node.node_id, originalQuestion)}
            className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-700 transition hover:bg-sky-100 dark:border-sky-700 dark:bg-sky-900/30 dark:text-sky-300 dark:hover:bg-sky-900/50"
          >
            🔬 Xem phân tích AI: {node.location_name} {node.risk_level && `(${node.risk_level})`}
          </button>
        ))}
      </div>
    )
  }

  /** Render danh sách khu vực để user chọn nhanh */
  function renderAreaSelector(keywords: string[]) {
    return (
      <div className="flex flex-wrap gap-2">
        <p className="w-full text-xs font-medium text-slate-600 dark:text-slate-400">Chọn khu vực:</p>
        {keywords.map((kw) => (
          <button
            key={kw}
            type="button"
            onClick={() => {
              setInput(`${kw} thế nào?`)   // ✅ dùng được vì nằm trong component
              inputRef.current?.focus()     // ✅ dùng được vì nằm trong component
            }}
            className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs transition hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700"
          >
            📍 {kw}
          </button>
        ))}
      </div>
    )
  }

  /** Gọi Tầng 2 – lấy báo cáo chuyên sâu khi user click nút node */
  async function handleExpertDetailClick(nodeId: string, originalQuestion: string) {
    try {
      const res = await callExpertDetailApi(nodeId, originalQuestion)
      if (res.success) {
        setMessages((prev: Message[]) => [   // ✅ dùng được vì nằm trong component
          ...prev,
          {
            id: `expert-${Date.now()}`,
            role: 'bot',
            text: res.data.answer,
            ts: new Date(),
          },
        ])
      }
    } catch (err: unknown) {
      let errorText = 'Lỗi khi lấy phân tích AI.'
      if (err instanceof Error) errorText = err.message
      setMessages((prev: Message[]) => [    // ✅ dùng được vì nằm trong component
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'bot',
          text: `❌ ${errorText}`,
          ts: new Date(),
        },
      ])
    }
  }

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleSend() {
    const text = input.trim()
    if (!text || loading) return

    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', text, ts: new Date() }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const result = await askChatbot(text)
      const botMsg: Message = {
        id: `b-${Date.now()}`,
        role: 'bot',
        text: result.reply,
        ts: new Date(),
        expertNodes: result.expertNodes,
        suggestAreas: result.suggestAreas,
        areaKeywords: result.areaKeywords,
        area: result.area,
        actionButton: result.actionButton,
      }
      setMessages((prev) => [...prev, botMsg])
    } catch (err: unknown) {
      let errorText = 'Xin lỗi, không thể kết nối đến máy chủ. Vui lòng thử lại sau.'
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: { message?: string } } } }
        const backendMsg = axiosErr.response?.data?.error?.message
        if (backendMsg) errorText = `❌ ${backendMsg}`
      }
      setMessages((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, role: 'bot', text: errorText, ts: new Date() },
      ])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-[480px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">

      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-200 bg-sky-600 px-4 py-3 dark:border-slate-700">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
          <Droplets className="h-4 w-4 text-white" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-bold text-white">AquaAlert AI</div>
          <div className="text-xs text-sky-100">Trợ lý dự báo lũ thông minh</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-white/70 hover:bg-white/10 hover:text-white"
          aria-label="Đóng chat"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.map((msg) => (
          <div key={msg.id}>
            {/* Message bubble */}
            <div className={`flex items-end gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              {/* Avatar */}
              <div
                className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-white ${msg.role === 'bot' ? 'bg-sky-500' : 'bg-slate-400 dark:bg-slate-600'
                  }`}
              >
                {msg.role === 'bot' ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
              </div>

              {/* Bubble */}
              <div
                className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${msg.role === 'user'
                  ? 'rounded-br-sm bg-sky-600 text-white'
                  : 'rounded-bl-sm bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100'
                  }`}
              >
                {renderText(msg.text)}
                <div
                  className={`mt-1 text-[10px] ${msg.role === 'user' ? 'text-sky-200' : 'text-slate-400 dark:text-slate-500'
                    }`}
                >
                  {msg.ts.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>

            {/* Render expertNodes nếu có */}
            {msg.role === 'bot' && msg.expertNodes && msg.expertNodes.length > 0 && (
              <div className="mt-2 space-y-2 pl-9">
                {renderExpertNodes(msg.expertNodes, msg.text)}
              </div>
            )}

            {/* Render actionButton nếu có */}
            {msg.role === 'bot' && msg.actionButton && (
              <div className="mt-2 pl-9">
                <button
                  type="button"
                  onClick={() => {
                    const parts = msg.actionButton!.payload.split('|')
                    if (parts.length > 1) {
                      void handleExpertDetailClick(parts[1], "Phân tích chuyên sâu")
                    }
                  }}
                  className="rounded-lg bg-sky-100 px-3 py-2 text-sm font-medium text-sky-800 transition hover:bg-sky-200 dark:bg-sky-900/50 dark:text-sky-300 dark:hover:bg-sky-900/70"
                >
                  {msg.actionButton.label}
                </button>
              </div>
            )}

            {/* Render area selector nếu có */}
            {msg.role === 'bot' && msg.suggestAreas && msg.areaKeywords && (
              <div className="mt-2 space-y-2 pl-9">
                {renderAreaSelector(msg.areaKeywords)}
              </div>
            )}
          </div>
        ))}

        {/* Typing indicator */}
        {loading && (
          <div className="flex items-end gap-2">
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-sky-500 text-white">
              <Bot className="h-4 w-4" />
            </div>
            <div className="rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-3 dark:bg-slate-800">
              <div className="flex gap-1">
                <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 dark:bg-slate-500" style={{ animationDelay: '0ms' }} />
                <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 dark:bg-slate-500" style={{ animationDelay: '150ms' }} />
                <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 dark:bg-slate-500" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Quick suggestions */}
      <div className="flex gap-2 overflow-x-auto px-4 pb-2 pt-1">
        {['Tình trạng ngập hiện tại', 'Khu vực nguy hiểm nhất', 'Lời khuyên an toàn'].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => { setInput(s); inputRef.current?.focus() }}
            className="flex-shrink-0 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700 transition hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-300 dark:hover:bg-sky-900/50"
          >
            {s}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="flex items-end gap-2 border-t border-slate-200 px-3 py-3 dark:border-slate-700">
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Nhập câu hỏi… (Enter để gửi)"
          className="flex-1 resize-none rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-sky-500 dark:focus:ring-sky-900/30"
          style={{ maxHeight: '96px', overflowY: 'auto' }}
          disabled={loading}
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!input.trim() || loading}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-sky-600 text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Gửi"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
