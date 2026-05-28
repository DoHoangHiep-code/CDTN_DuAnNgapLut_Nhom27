import { useRef, useState, useEffect, useCallback } from 'react'
import { X } from 'lucide-react'
import { ChatInterface } from './ChatInterface'
import { useDisasterMode } from '../../context/DisasterContext'

const SNAP_MARGIN = 16 // px from edge when snapping

const TOOLTIP_MESSAGES = {
  default: [
    "Xin chào 👋",
    "Bạn cần tôi giúp gì?",
    "Tôi có thể giúp gì cho bạn?",
    "Bạn có cần hỗ trợ không?"
  ],
  landslide: [
    "Bạn muốn kiểm tra sạt lở?",
    "Khu vực của bạn an toàn chứ?",
    "Xem độ ổn định sườn dốc?"
  ],
  flood: [
    "Bạn cần xem dự báo ngập lụt?",
    "Có khu vực nào ngập không?",
    "Xem chi tiết lượng mưa?"
  ]
}

export function FloatingChatBotIcon() {
  const [isOpen, setIsOpen] = useState(false)
  const [pos, setPos] = useState({ x: window.innerWidth - 80, y: window.innerHeight - 80 })
  const dragging = useRef(false)
  const dragOffset = useRef({ x: 0, y: 0 })
  const moved = useRef(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const { mode } = useDisasterMode()

  const [showTooltip, setShowTooltip] = useState(false)
  const [tooltipText, setTooltipText] = useState('')
  const [hasInteracted, setHasInteracted] = useState(false)

  useEffect(() => {
    if (!isOpen && !hasInteracted && !showTooltip) {
      const timer = setTimeout(() => {
        const modeList = TOOLTIP_MESSAGES[mode === 'landslide' ? 'landslide' : 'flood']
        const allMsgs = [...TOOLTIP_MESSAGES.default, ...modeList]
        const randomMsg = allMsgs[Math.floor(Math.random() * allMsgs.length)]
        setTooltipText(randomMsg)
        setShowTooltip(true)
      }, 7000)
      return () => clearTimeout(timer)
    }
  }, [isOpen, hasInteracted, showTooltip, mode])

  useEffect(() => {
    if (showTooltip) {
      const hideTimer = setTimeout(() => {
        setShowTooltip(false)
        // Không setHasInteracted(true) ở đây để nó có thể lặp lại sau 7s
      }, 5000)
      return () => clearTimeout(hideTimer)
    }
  }, [showTooltip])

  const clamp = useCallback((x: number, y: number) => ({
    x: Math.max(SNAP_MARGIN, Math.min(window.innerWidth - 56 - SNAP_MARGIN, x)),
    y: Math.max(SNAP_MARGIN, Math.min(window.innerHeight - 56 - SNAP_MARGIN, y)),
  }), [])

  // Snap to nearest edge on drag end (like iPhone AssistiveTouch)
  const snapToEdge = useCallback((x: number, y: number) => {
    const cx = x + 28 // center x
    const distLeft = cx
    const distRight = window.innerWidth - cx
    const distTop = y + 28
    const distBottom = window.innerHeight - (y + 28)
    const minDist = Math.min(distLeft, distRight, distTop, distBottom)

    if (minDist === distLeft) return { x: SNAP_MARGIN, y }
    if (minDist === distRight) return { x: window.innerWidth - 56 - SNAP_MARGIN, y }
    if (minDist === distTop) return { x, y: SNAP_MARGIN }
    return { x, y: window.innerHeight - 56 - SNAP_MARGIN }
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    dragging.current = true
    moved.current = false
    dragOffset.current = {
      x: e.clientX - pos.x,
      y: e.clientY - pos.y,
    }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    e.preventDefault()
  }, [pos])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return
    moved.current = true
    const raw = {
      x: e.clientX - dragOffset.current.x,
      y: e.clientY - dragOffset.current.y,
    }
    setPos(clamp(raw.x, raw.y))
  }, [clamp])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return
    dragging.current = false
    if (moved.current) {
      // Snap to nearest edge
      setPos((p) => snapToEdge(p.x, p.y))
    } else {
      // It was a tap — toggle chat
      setIsOpen((o) => !o)
      setHasInteracted(true)
      setShowTooltip(false)
    }
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
  }, [snapToEdge])

  // Reposition on window resize to stay in bounds
  useEffect(() => {
    const onResize = () => setPos((p) => clamp(p.x, p.y))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [clamp])

  // Chat window position: try to keep it visible
  const chatRight = window.innerWidth - pos.x - 56
  const chatBottom = window.innerHeight - pos.y - 56
  const chatStyle: React.CSSProperties = {
    right: Math.max(8, chatRight),
    bottom: Math.max(8, chatBottom + 8),
  }

  return (
    <>
      {/* Floating button */}
      {!isOpen && (
        <button
          ref={buttonRef}
          type="button"
          aria-label="Mở chatbot hỗ trợ"
          style={{ left: pos.x, top: pos.y, touchAction: 'none' }}
          className={`fixed z-[9999] flex h-16 w-16 items-center justify-center rounded-full shadow-xl transition-transform hover:scale-105 active:scale-95 select-none overflow-hidden p-0 animate-bounce hover:animate-none ${
            mode === 'landslide'
              ? 'bg-gradient-to-br from-amber-500 to-orange-600 shadow-amber-500/30'
              : 'bg-gradient-to-br from-cyan-400 to-blue-500 shadow-cyan-500/30'
          }`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <img 
            src={mode === 'landslide' ? '/landslide_bot.png' : '/okicon.png'} 
            alt="Chatbot" 
            className="h-full w-full object-cover" 
            draggable={false} 
          />
        </button>
      )}

      {/* Floating Tooltip */}
      {!isOpen && showTooltip && (
        <div
          className={`fixed z-[9999] px-4 py-2.5 rounded-2xl shadow-xl text-sm font-bold cursor-pointer transition-all hover:scale-105 ${
            mode === 'landslide'
              ? 'bg-amber-50 text-amber-800 border border-amber-300 shadow-amber-500/20 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800'
              : 'bg-sky-50 text-sky-800 border border-sky-300 shadow-sky-500/20 dark:bg-sky-950 dark:text-sky-200 dark:border-sky-800'
          }`}
          style={{
            right: window.innerWidth - pos.x + 8,
            top: pos.y + 12,
          }}
          onClick={() => {
            setIsOpen(true)
            setShowTooltip(false)
            setHasInteracted(true)
          }}
        >
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${mode === 'landslide' ? 'bg-amber-500' : 'bg-sky-500'}`}></span>
              <span className={`relative inline-flex rounded-full h-2 w-2 ${mode === 'landslide' ? 'bg-amber-500' : 'bg-sky-500'}`}></span>
            </span>
            {tooltipText}
          </div>
          {/* Arrow pointing right */}
          <div 
            className={`absolute -right-[5px] top-1/2 -translate-y-1/2 w-2.5 h-2.5 rotate-45 border-r border-t ${
              mode === 'landslide' 
                ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950' 
                : 'border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950'
            }`}
          />
        </div>
      )}

      {/* Chat window */}
      {isOpen && (
        <div
          style={chatStyle}
          className="fixed z-[9998] w-[360px] max-w-[calc(100vw-32px)]"
        >
          <ChatInterface onClose={() => setIsOpen(false)} />
        </div>
      )}
    </>
  )
}
