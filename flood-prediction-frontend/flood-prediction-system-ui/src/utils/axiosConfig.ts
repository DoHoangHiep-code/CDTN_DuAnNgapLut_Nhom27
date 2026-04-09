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
  // - Ưu tiên lấy từ env để bạn dễ đổi port (3000/3001) mà không phải sửa code.
  // - Fallback về localhost:3001 vì backend hiện tại đang chạy mặc định trên 3001.
  baseURL: (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:3001/api/v1',
  timeout: 15000,
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

// Response interceptor: bắt 401 toàn cục
apiV1.interceptors.response.use(
  (res) => res,
  (error) => {
    // Lý do bắt 401 toàn cục:
    // - Token hết hạn / bị thu hồi -> app phải tự logout để tránh loop lỗi.
    const status = error?.response?.status
    if (status === 401) {
      // Xóa token để tránh gửi lại token lỗi ở các request sau
      clearToken()
      // Điều hướng về /login (dùng window.location để không phụ thuộc hook router)
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  },
)

