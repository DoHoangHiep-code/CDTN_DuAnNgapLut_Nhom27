/**
 * expertChatApi.ts
 *
 * API client cho chatbot:
 * - POST /api/v1/chatbot/ask
 * - POST /api/v1/chatbot/expert-detail
 */

export interface FloodFeatures {
  grid_id?: string
  lat?: number
  lng?: number
}

export interface ExpertChatRequest {
  question: string
  grid_id?: string
  lat?: number
  lng?: number
}

export interface ExpertChatResponse {
  success: boolean
  data: {
    answer: string
    risk_level: 'safe' | 'medium' | 'high' | 'severe' | null
    flood_depth_cm: number | null
    location_name: string | null
    source: 'cache' | 'db' | 'fallback'
  }
  error?: { message: string }
}

export interface ExpertNode {
  node_id: string
  location_name: string
  risk_level: 'safe' | 'medium' | 'high' | 'severe'
}

export interface ChatbotResponse {
  success: boolean
  data?: {
    reply: string
    intent: string
    area?: string
    expertNodes?: ExpertNode[]
    suggestAreas?: boolean
    areaKeywords?: string[]
    actionButton?: { label: string; payload: string }
  }

  // Một số backend có thể trả reply ở top-level
  reply?: string
  intent?: string
  area?: string
  expertNodes?: ExpertNode[]
  suggestAreas?: boolean
  areaKeywords?: string[]
  actionButton?: { label: string; payload: string }

  error?: { message: string }
}

export interface ExpertDetailRequest {
  node_id: string
  question?: string
}

export interface ExpertDetailResponse {
  success: boolean
  data: {
    answer: string
    risk_level: 'safe' | 'medium' | 'high' | 'severe' | null
    flood_depth_cm: number | null
    location_name: string | null
    source: 'cache' | 'db' | 'fallback'
  }
  error?: { message: string }
}

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3002/api/v1'

/**
 * Timeout:
 * - ask chatbot nhanh: 9s
 * - expert detail: 10s
 */
const CHATBOT_TIMEOUT_MS = 9_000
const EXPERT_TIMEOUT_MS = 10_000

function getFriendlyMessage(status: number | null, isTimeout: boolean): string {
  if (isTimeout) {
    return '⚠️ Hệ thống đang quá tải hoặc model đang cần nhiều thời gian xử lý, vui lòng thử lại sau.'
  }

  if (status === 500) {
    return 'Lỗi backend khi xử lý chatbot. Vui lòng kiểm tra terminal backend để xem lỗi chi tiết.'
  }

  if (status === 503) {
    return 'Dịch vụ phân tích AI hiện chưa sẵn sàng. Vui lòng kiểm tra Python AI service hoặc floodFeature.service.js.'
  }

  if (status === 502 || status === 504) {
    return 'Cổng kết nối tới dịch vụ AI bị gián đoạn. Vui lòng thử lại sau.'
  }

  return `Lỗi máy chủ: HTTP ${status ?? 'không xác định'}.`
}

async function postJson<T>(
  url: string,
  body: unknown,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController()
  const timerId = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    const text = await res.text()
    let json: any = {}

    try {
      json = text ? JSON.parse(text) : {}
    } catch {
      json = { message: text }
    }

    if (!res.ok) {
      const backendMsg =
        json?.error?.message ||
        json?.message ||
        json?.reply ||
        json?.data?.answer

      throw new Error(backendMsg || getFriendlyMessage(res.status, false))
    }

    return json as T
  } catch (err: unknown) {
    const isAbort = err instanceof DOMException && err.name === 'AbortError'

    if (isAbort) {
      throw new Error(getFriendlyMessage(null, true))
    }

    throw err
  } finally {
    window.clearTimeout(timerId)
  }
}

/**
 * Gọi chatbot nhanh:
 * POST /api/v1/chatbot/ask
 */
export async function askChatbot(message: string): Promise<ChatbotResponse> {
  return postJson<ChatbotResponse>(
    `${BASE_URL}/chatbot/ask`,
    { message },
    CHATBOT_TIMEOUT_MS
  )
}

/**
 * Gọi phân tích AI chi tiết:
 * POST /api/v1/chatbot/expert-detail
 */
export async function callExpertDetail(
  nodeId: string,
  question = ''
): Promise<ExpertDetailResponse> {
  return postJson<ExpertDetailResponse>(
    `${BASE_URL}/chatbot/expert-detail`,
    {
      node_id: nodeId,
      question,
    },
    EXPERT_TIMEOUT_MS
  )
}

/**
 * Hàm giữ lại để tương thích với component cũ nếu còn dùng askExpertChat.
 * Ưu tiên dùng callExpertDetail(nodeId, question) cho code mới.
 */
export async function askExpertChat(
  payload: ExpertChatRequest
): Promise<ExpertChatResponse> {
  const nodeId = payload.grid_id

  if (!nodeId) {
    throw new Error(
      'Thiếu grid_id/node_id. Với endpoint /chatbot/expert-detail, frontend cần truyền node_id để phân tích AI chi tiết.'
    )
  }

  return postJson<ExpertChatResponse>(
    `${BASE_URL}/chatbot/expert-detail`,
    {
      node_id: nodeId,
      question: payload.question,
      lat: payload.lat,
      lng: payload.lng,
    },
    EXPERT_TIMEOUT_MS
  )
}