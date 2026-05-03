import { useEffect, useRef, useState } from 'react'
import { Send, Bot, User, X, Droplets } from 'lucide-react'
import { apiV1 } from '../utils/axiosConfig'

interface Message {
  id: string
  role: 'user' | 'bot'
  text: string
  ts: Date
}

interface Props {
  onClose: () => void
}

async function askChatbot(question: string): Promise<string> {
  const res = await apiV1.post('/chatbot/ask', {
    message: question,
  })

  console.log('Chatbot response full:', JSON.stringify(res.data, null, 2))

  if (!res.data?.success) {
    return res.data?.error?.message || 'Chatbot lỗi.'
  }

  const answer =
    res.data?.data?.answer ||
    res.data?.data?.reply ||
    res.data?.answer ||
    res.data?.reply

  if (typeof answer === 'string' && answer.trim()) {
    return answer
  }

  return 'Bot có phản hồi nhưng không tìm thấy nội dung trả lời. Hãy kiểm tra backend trả về field data.answer hoặc data.reply.'
}

function renderText(text: unknown) {
  const safeText =
    typeof text === 'string'
      ? text
      : JSON.stringify(text, null, 2)

  return safeText.split('\n').map((line, lineIndex) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g)

    return (
      <div key={lineIndex}>
        {parts.map((p, i) =>
          p.startsWith('**') && p.endsWith('**')
            ? <strong key={i}>{p.slice(2, -2)}</strong>
            : <span key={i}>{p}</span>
        )}
      </div>
    )
  })
}

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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  async function handleSend() {
    const text = input.trim()
    if (!text || loading) return

    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', text, ts: new Date() }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const answer = await askChatbot(text)

      setMessages((prev) => [
        ...prev,
        {
          id: `b-${Date.now()}`,
          role: 'bot',
          text: typeof answer === 'string' ? answer : JSON.stringify(answer, null, 2),
          ts: new Date(),
        },
      ])
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'bot',
          text: 'Xin lỗi, không thể kết nối đến máy chủ. Vui lòng thử lại sau.',
          ts: new Date(),
        },
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
          <div
            key={msg.id}
            className={`flex items-end gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
          >
            {/* Avatar */}
            <div
              className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-white ${
                msg.role === 'bot' ? 'bg-sky-500' : 'bg-slate-400 dark:bg-slate-600'
              }`}
            >
              {msg.role === 'bot' ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
            </div>

            {/* Bubble */}
            <div
              className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'rounded-br-sm bg-sky-600 text-white'
                  : 'rounded-bl-sm bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100'
              }`}
            >
              {renderText(msg.text)}
              <div
                className={`mt-1 text-[10px] ${
                  msg.role === 'user' ? 'text-sky-200' : 'text-slate-400 dark:text-slate-500'
                }`}
              >
                {msg.ts.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
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
