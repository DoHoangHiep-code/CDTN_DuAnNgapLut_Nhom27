import axios from 'axios'

// Lý do tách file cấu hình Axios:
// - Tập trung hóa baseURL, attach JWT, và xử lý 401 toàn cục.
// - Giảm rủi ro quên gắn token ở từng request (lỗi bảo mật phổ biến).

const TOKEN_KEY = 'fps_jwt_token'

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // ignore: localStorage có thể bị chặn ở một số môi trường
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // ignore
  }
}

export const apiV1 = axios.create({
  // Backend baseURL:
  // - Ưu tiên lấy từ env VITE_API_BASE_URL (khai báo trong .env.local).
  // - Fallback về localhost:3002 (port mặc định của backend).
  baseURL: (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:3002/api/v1',
  // Tăng timeout lên 60s vì:
  //  - CockroachDB cloud có độ trễ kết nối cao hơn localhost
  //  - AI CatBoost model cần thời gian khởi động lại nếu cold-start
  //  - Spatial query + LATERAL JOIN trên 53K nodes cần vài giây ngay cả khi đã index
  timeout: 60000,
})

// Request interceptor: tự động gắn JWT vào header Authorization
apiV1.interceptors.request.use((config) => {
  // Vì token nằm ở localStorage, ta luôn đọc token mới nhất trước khi gửi request
  const token = getToken()
  if (token) {
    // Header theo chuẩn Bearer để backend verifyToken đọc được
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Response interceptor: bắt 401 toàn cục + gán friendly message cho timeout/503
apiV1.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error?.response?.status
    const isTimeout = error?.code === 'ECONNABORTED' || error?.message?.includes('timeout')

    // ── 401: Token hết hạn → tự logout ──────────────────────────────────────────
    if (status === 401) {
      clearToken()
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
    }

    // ── Gắn friendly message để UI có thể hiển thị trực tiếp ─────────────────
    // Lý do: tránh phải viết logic phân loại lỗi rải rác ở mỗi component/page.
    if (isTimeout) {
      error.friendlyMessage =
        'Hệ thống đang xử lý lượng dữ liệu lớn hoặc model AI cần thêm thời gian khởi động. Vui lòng thử lại sau.'
    } else if (status === 503) {
      error.friendlyMessage =
        'Máy chủ đang quá tải (503). Vui lòng đợi vài giây rồi thử lại.'
    } else if (status === 502 || status === 504) {
      error.friendlyMessage =
        'Cổng kết nối tới dịch vụ AI bị gián đoạn. Vui lòng thử lại sau ít phút.'
    }

    return Promise.reject(error)
  },
)

