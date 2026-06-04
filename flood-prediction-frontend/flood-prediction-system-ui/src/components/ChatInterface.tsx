import { useEffect, useRef, useState } from 'react'
import { Send, Bot, User, X, Droplets, Mountain } from 'lucide-react'
import { askChatbot as askChatbotApi, callExpertDetail as callExpertDetailApi, getAreaNodes } from '../services/expertChatApi'
import { useAuth } from '../context/AuthContext'
import { useDisasterMode } from '../context/DisasterContext'
import { LandslideMap } from '../features/landslide/components/LandslideMap'

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
  question: string,
  domain?: 'flood' | 'landslide'
): Promise<{ reply: string; expertNodes?: any[]; suggestAreas?: boolean; areaKeywords?: string[]; area?: string; actionButton?: { label: string; payload: string } }> {
  try {
    const res = await askChatbotApi(question, domain)
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
  const { user } = useAuth()
  const { mode } = useDisasterMode()
  
  const getAvatarUrl = (url?: string | null) => {
    if (!url) return null
    if (url.startsWith('http')) return url
    const apiUrl = (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:3002/api/v1'
    const baseUrl = apiUrl.replace(/\/api\/v1\/?$/, '')
    return `${baseUrl.replace(/\/+$/, '')}${url}`
  }
  
  const userAvatar = getAvatarUrl(user?.avatar_url)

  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [elevationMapConfig, setElevationMapConfig] = useState<{ lat: number; lng: number; label: string } | null>(null)
  const [areaNodes, setAreaNodes] = useState<any[]>([])
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
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
              mode === 'landslide'
                ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50'
                : 'border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-700 dark:bg-sky-900/30 dark:text-sky-300 dark:hover:bg-sky-900/50'
            }`}
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
    setMessages([
      {
        id: `welcome-${mode}-${Date.now()}`,
        role: 'bot',
        text: mode === 'landslide'
          ? 'Xin chào! Tôi là trợ lý AI của hệ thống AquaAlert. Bạn có thể hỏi tôi về tình trạng sạt lở, độ ổn định sườn dốc, khu vực nguy cơ cao, hoặc các lời khuyên an toàn. ⛰️'
          : 'Xin chào! Tôi là trợ lý AI của hệ thống AquaAlert. Bạn có thể hỏi tôi về tình trạng ngập lụt, dự báo mưa, khu vực nguy hiểm, hoặc các lời khuyên an toàn. 💧',
        ts: new Date(),
      }
    ])
  }, [mode])

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
      const result = await askChatbot(text, mode)
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
    <div className="flex h-[480px] flex-col overflow-hidden rounded-3xl border border-slate-200/60 bg-white/90 backdrop-blur-xl shadow-[0_20px_50px_-12px_rgba(0,0,0,0.25)] dark:border-slate-700/60 dark:bg-slate-900/90 relative">
      <style>{`
        @keyframes slideUpFade {
          0% { opacity: 0; transform: translateY(12px) scale(0.98); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        .msg-animate {
          animation: slideUpFade 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>
      {/* Header */}
      <div className={`flex items-center gap-3 px-4 py-3.5 shadow-md z-10 ${
        mode === 'landslide' ? 'bg-gradient-to-r from-amber-600 to-orange-700' : 'bg-gradient-to-r from-cyan-500 to-blue-600'
      }`}>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
          {mode === 'landslide' ? <Mountain className="h-4 w-4 text-white" /> : <Droplets className="h-4 w-4 text-white" />}
        </div>
        <div className="flex-1">
          <div className="text-sm font-bold text-white">
            {mode === 'landslide' ? 'Landslide AI' : 'AquaAlert AI'}
          </div>
          <div className={`text-xs ${mode === 'landslide' ? 'text-amber-100' : 'text-sky-100'}`}>
            {mode === 'landslide' ? 'Trợ lý dự báo sạt lở thông minh' : 'Trợ lý dự báo lũ thông minh'}
          </div>
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
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 scroll-smooth">
        {messages.map((msg) => (
          <div key={msg.id} className="msg-animate">
            {/* Message bubble */}
            <div className={`flex items-end gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              {/* Avatar */}
              <div
                className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-white shadow-sm ring-2 ring-white/50 ${
                  msg.role === 'bot' 
                    ? (mode === 'landslide' ? 'bg-gradient-to-br from-amber-400 to-orange-500' : 'bg-gradient-to-br from-cyan-400 to-blue-500')
                    : 'bg-slate-300 dark:bg-slate-600'
                  }`}
              >
                {msg.role === 'bot' ? (
                  <Bot className="h-4 w-4" />
                ) : userAvatar ? (
                  <img src={userAvatar} alt="user" className="h-full w-full rounded-full object-cover" />
                ) : (
                  <User className="h-4 w-4 text-slate-500 dark:text-slate-300" />
                )}
              </div>

              {/* Bubble */}
              <div
                className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm ${
                  msg.role === 'user'
                    ? (mode === 'landslide' 
                        ? 'rounded-br-sm bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-amber-500/20'
                        : 'rounded-br-sm bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-cyan-500/20')
                    : 'rounded-bl-sm bg-white border border-slate-100 text-slate-800 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100'
                  }`}
              >
                {renderText(msg.text)}
                <div
                  className={`mt-1 text-[10px] ${
                    msg.role === 'user' 
                      ? (mode === 'landslide' ? 'text-amber-200' : 'text-sky-200')
                      : 'text-slate-400 dark:text-slate-500'
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
                    if (msg.actionButton!.payload === 'OPEN_ELEVATION_MAP') {
                      let lat = 21.0278;
                      let lng = 105.8342;
                      let label = 'Hà Nội';
                      const area = msg.area?.toLowerCase() || '';
                      if (area.includes('triều khúc')) {
                        lat = 20.985;
                        lng = 105.798;
                        label = 'Triều Khúc';
                      } else if (area.includes('phạm hùng')) {
                        lat = 21.016;
                        lng = 105.783;
                        label = 'Đường Phạm Hùng';
                      } else if (area.includes('nguyễn trãi')) {
                        lat = 20.998;
                        lng = 105.802;
                        label = 'Đường Nguyễn Trãi';
                      }
                      setElevationMapConfig({ lat, lng, label });
                      if (msg.area) {
                        getAreaNodes(msg.area).then(res => {
                          if (res && res.success && res.nodes) {
                            setAreaNodes(res.nodes);
                          } else {
                            setAreaNodes([]);
                          }
                        });
                      } else {
                        setAreaNodes([]);
                      }
                      return;
                    }
                    const parts = msg.actionButton!.payload.split('|')
                    if (parts.length > 1) {
                      void handleExpertDetailClick(parts[1], "Phân tích chuyên sâu")
                    }
                  }}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                    mode === 'landslide'
                      ? 'bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-900/50 dark:text-amber-300 dark:hover:bg-amber-900/70'
                      : 'bg-sky-100 text-sky-800 hover:bg-sky-200 dark:bg-sky-900/50 dark:text-sky-300 dark:hover:bg-sky-900/70'
                  }`}
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
          <div className="flex items-end gap-2 msg-animate">
            <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-white shadow-sm ${
              mode === 'landslide' ? 'bg-gradient-to-br from-amber-400 to-orange-500' : 'bg-gradient-to-br from-cyan-400 to-blue-500'
            }`}>
              <Bot className="h-4 w-4" />
            </div>
            <div className="rounded-2xl rounded-bl-sm bg-white border border-slate-100 px-4 py-3 shadow-sm dark:bg-slate-800 dark:border-slate-700">
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
        {(mode === 'landslide' 
          ? ['Khu vực nguy cơ sạt lở', 'Độ ổn định sườn dốc', 'Lời khuyên an toàn']
          : ['Tình trạng ngập hiện tại', 'Khu vực nguy hiểm nhất', 'Lời khuyên an toàn']).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => { setInput(s); inputRef.current?.focus() }}
            className={`flex-shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition ${
              mode === 'landslide'
                ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50'
                : 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-300 dark:hover:bg-sky-900/50'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="flex items-end gap-2 border-t border-slate-100/60 bg-white/50 px-3 py-3 backdrop-blur-md dark:border-slate-700/60 dark:bg-slate-900/50">
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Nhập câu hỏi… (Enter để gửi)"
          className={`flex-1 resize-none rounded-2xl border bg-white/80 px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 outline-none transition dark:bg-slate-800/80 dark:text-slate-100 dark:placeholder-slate-500 ${
            mode === 'landslide'
              ? 'border-slate-200 focus:border-amber-400 focus:ring-4 focus:ring-amber-500/10 dark:border-slate-600 dark:focus:border-amber-500 dark:focus:ring-amber-900/30'
              : 'border-slate-200 focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:border-slate-600 dark:focus:border-cyan-500 dark:focus:ring-cyan-900/30'
          }`}
          style={{ maxHeight: '96px', overflowY: 'auto' }}
          disabled={loading}
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!input.trim() || loading}
          className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-white shadow-md transition hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-40 ${
            mode === 'landslide'
              ? 'bg-gradient-to-br from-amber-500 to-orange-600 shadow-amber-500/20'
              : 'bg-gradient-to-br from-cyan-500 to-blue-600 shadow-cyan-500/20'
          }`}
          aria-label="Gửi"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>

      {/* Elevation Map Overlay */}
      {elevationMapConfig && (
        <div className="absolute inset-0 bg-white dark:bg-slate-900 z-[100] flex flex-col rounded-3xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
          {/* Map Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex-shrink-0">
            <span className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <span>🗺️</span> Bản đồ Cao độ: {elevationMapConfig.label}
            </span>
            <button
              type="button"
              onClick={() => setElevationMapConfig(null)}
              className="rounded-lg p-1 text-slate-500 hover:bg-slate-200/60 dark:text-slate-400 dark:hover:bg-slate-700/60"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          
          {/* Map Content */}
          <div className="flex-1 relative z-0 min-h-0">
            {/* Floating Close Button */}
            <button
              type="button"
              onClick={() => setElevationMapConfig(null)}
              className="absolute top-4 right-4 z-[1000] flex h-10 w-10 items-center justify-center rounded-full bg-slate-900/80 hover:bg-slate-900 text-white shadow-lg backdrop-blur-sm transition-all hover:scale-105 active:scale-95 border border-white/20"
              title="Thoát bản đồ"
            >
              <X className="h-5 w-5" />
            </button>

            <LandslideMap 
              tileStyle="terrain" 
              hideHUD={true} 
              hideDangerPoints={true} 
              searchMarker={[elevationMapConfig.lat, elevationMapConfig.lng]} 
              elevationNodes={areaNodes}
            />
            {/* Legend */}
            <div className="absolute bottom-4 left-4 z-[1000] bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-800 p-2.5 rounded-xl text-[10px] space-y-1 shadow-md select-none pointer-events-none">
              <div className="font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider text-[9px] mb-1">Cao Độ Địa Hình (m)</div>
              <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#16a34a]" /> <span>&gt; 5.5m (An toàn)</span></div>
              <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#f59e0b]" /> <span>4.5m - 5.5m (TB)</span></div>
              <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#f97316]" /> <span>3.5m - 4.5m (Thấp)</span></div>
              <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#e11d48]" /> <span>&le; 3.5m (Vùng trũng)</span></div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
