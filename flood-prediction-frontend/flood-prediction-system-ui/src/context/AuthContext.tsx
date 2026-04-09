import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import type { Role } from '../utils/types'
import { authLogin, getMyProfile } from '../services/api'
import { clearToken, getToken, setToken } from '../utils/axiosConfig'

export type UserProfile = {
  user_id: number
  full_name: string
  email: string
  role: Role
  avatar_url?: string | null
}

type AuthState = {
  token: string | null
  user: UserProfile | null
  loading: boolean
}

type AuthContextValue = AuthState & {
  isAuthenticated: boolean
  login: (payload: { email: string; password: string }) => Promise<void>
  logout: () => void
  fetchProfile: () => Promise<void>
  hasAnyRole: (roles: Role[]) => boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

function normalizeUser(u: any): UserProfile {
  return {
    user_id: Number(u.user_id),
    full_name: String(u.full_name ?? u.name ?? ''),
    email: String(u.email ?? ''),
    role: u.role as Role,
    avatar_url: u.avatar_url ?? null,
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Lý do có loading:
  // - Khi app load và có token, ta cần gọi /users/profile để hydrate user.
  // - Tránh render layout “nhấp nháy” giữa login và dashboard.
  const [state, setState] = useState<AuthState>(() => ({
    token: getToken(),
    user: null,
    loading: true,
  }))

  // Khi app khởi động: nếu có token thì fetchProfile, nếu không thì tắt loading
  useEffect(() => {
    const token = getToken()
    if (!token) {
      setState((s) => ({ ...s, token: null, user: null, loading: false }))
      return
    }
    void (async () => {
      try {
        const res = await getMyProfile()
        setState({ token, user: normalizeUser(res.data), loading: false })
      } catch {
        // Nếu token invalid -> interceptor đã clearToken và redirect /login
        setState({ token: null, user: null, loading: false })
      }
    })()
  }, [])

  const value: AuthContextValue = useMemo(
    () => ({
      ...state,
      isAuthenticated: Boolean(state.token && state.user),
      login: async ({ email, password }) => {
        // Gọi backend login thật
        const res = await authLogin({ email, password })
        const token = res.data.token
        const user = normalizeUser(res.data.user)

        // Lưu token để interceptor gắn vào các request sau
        setToken(token)

        // Set state để UI cập nhật
        setState({ token, user, loading: false })
      },
      logout: () => {
        // Xóa token để tránh tiếp tục dùng token cũ
        clearToken()
        setState({ token: null, user: null, loading: false })
      },
      fetchProfile: async () => {
        // Cho phép các trang chủ động refresh profile sau update avatar/name
        const token = getToken()
        if (!token) {
          setState({ token: null, user: null, loading: false })
          return
        }
        try {
          const res = await getMyProfile()
          setState({ token, user: normalizeUser(res.data), loading: false })
        } catch (e) {
          clearToken()
          setState({ token: null, user: null, loading: false })
          toast.error('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.')
        }
      },
      hasAnyRole: (roles) => {
        const role = state.user?.role
        if (!role) return false
        return roles.includes(role)
      },
    }),
    [state],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

