import { useEffect, useRef, useState } from 'react'

// ── Định nghĩa các bước "Thinking" theo thứ tự thời gian ─────────────────────

/**
 * Mỗi bước gồm:
 *  - text   : Chuỗi hiển thị trên UI
 *  - delay  : Thời điểm BẮT ĐẦU hiển thị bước này (ms, tính từ lúc bắt đầu)
 */
const THINKING_STEPS: ReadonlyArray<{ text: string; delay: number }> = [
  { text: '🗺️ Đang phân tích tọa độ địa hình...', delay: 0    },
  { text: '🌧️ Đang truy xuất dữ liệu mưa từ radar...', delay: 2000 },
  { text: '🤖 AI đang chạy mô hình mô phỏng ngập lụt...', delay: 4000 },
]

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * useThinkingSteps – Hook giả lập các bước xử lý khi chờ API phản hồi.
 *
 * Mục đích: Thay vì hiển thị spinner tĩnh trong 6–8 giây chờ AI,
 * hook này tự động đổi text theo mốc thời gian, tạo cảm giác hệ thống
 * đang "suy nghĩ" và giúp người dùng hiểu quy trình xử lý.
 *
 * Sử dụng:
 * ```tsx
 * const { thinkingText, startThinking, stopThinking } = useThinkingSteps()
 *
 * // Gọi khi bắt đầu loading:
 * startThinking()
 *
 * // Render trong JSX:
 * {isLoading && <span>{thinkingText}</span>}
 *
 * // Gọi khi nhận được response (hoặc lỗi):
 * stopThinking()
 * ```
 *
 * @returns {{
 *   thinkingText: string,       - Text hiện đang hiển thị
 *   stepIndex: number,          - Index bước hiện tại (0, 1, 2, …)
 *   isThinking: boolean,        - true khi đang trong trạng thái thinking
 *   startThinking: () => void,  - Bắt đầu chuỗi thinking
 *   stopThinking: () => void,   - Dừng và reset về trạng thái ban đầu
 * }}
 */
export function useThinkingSteps() {
  // Text hiển thị hiện tại
  const [thinkingText, setThinkingText] = useState<string>(THINKING_STEPS[0].text)
  // Index của bước hiện tại
  const [stepIndex, setStepIndex] = useState<number>(0)
  // Trạng thái thinking
  const [isThinking, setIsThinking] = useState<boolean>(false)

  // Ref lưu danh sách timer IDs để cleanup khi stop/unmount
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  /** Dọn dẹp tất cả timer đang chạy */
  const clearAllTimers = () => {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
  }

  /** Bắt đầu chuỗi thinking: lên lịch đổi text theo từng mốc thời gian */
  const startThinking = () => {
    // Reset về trạng thái ban đầu trước khi bắt đầu
    clearAllTimers()
    setThinkingText(THINKING_STEPS[0].text)
    setStepIndex(0)
    setIsThinking(true)

    // Lên lịch cho từng bước (bỏ qua bước 0 vì đã set ngay ở trên)
    THINKING_STEPS.forEach((step, index) => {
      if (index === 0) return // Bước 0 đã active ngay lập tức

      const timer = setTimeout(() => {
        setThinkingText(step.text)
        setStepIndex(index)
      }, step.delay)

      timersRef.current.push(timer)
    })
  }

  /** Dừng thinking và reset – gọi khi nhận được response (thành công hoặc lỗi) */
  const stopThinking = () => {
    clearAllTimers()
    setIsThinking(false)
    // Reset về bước đầu để lần sau startThinking() bắt đầu từ đúng trạng thái
    setThinkingText(THINKING_STEPS[0].text)
    setStepIndex(0)
  }

  // Cleanup khi component unmount để tránh memory leak / state update trên unmounted component
  useEffect(() => {
    return () => {
      clearAllTimers()
    }
  }, [])

  return { thinkingText, stepIndex, isThinking, startThinking, stopThinking }
}

// ── Export steps để component có thể render progress bar ─────────────────────
export { THINKING_STEPS }
export type ThinkingStep = (typeof THINKING_STEPS)[number]
