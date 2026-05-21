import { useRef, useState, useEffect, useCallback } from 'react'
import { X } from 'lucide-react'
import { ChatInterface } from './ChatInterface'

const SNAP_MARGIN = 16 // px from edge when snapping

export function FloatingChatBotIcon() {
  const [isOpen, setIsOpen] = useState(false)
  const [pos, setPos] = useState({ x: window.innerWidth - 80, y: window.innerHeight - 80 })
  const dragging = useRef(false)
  const dragOffset = useRef({ x: 0, y: 0 })
  const moved = useRef(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

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
      <button
        ref={buttonRef}
        type="button"
        aria-label={isOpen ? 'Đóng chatbot' : 'Mở chatbot hỗ trợ'}
        style={{ left: pos.x, top: pos.y, touchAction: 'none' }}
        className="fixed z-[9999] flex h-16 w-16 items-center justify-center rounded-full bg-sky-600 shadow-xl ring-2 ring-white transition-transform hover:scale-105 active:scale-95 dark:ring-slate-800 select-none overflow-hidden p-0"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {isOpen ? (
          <X className="h-6 w-6 text-white" />
        ) : (
          <img src="/okicon.png" alt="Chatbot" className="h-full w-full object-cover" draggable={false} />
        )}
      </button>

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
