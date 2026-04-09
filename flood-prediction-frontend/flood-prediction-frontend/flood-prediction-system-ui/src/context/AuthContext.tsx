import React, { createContext, useContext, useMemo, useState } from 'react'
import type { Role } from '../utils/types'

export type UserProfile = {
  name: string
  email: string
  role: Role
}

type AuthState = {
  token: string | null
  user: UserProfile | null
}

type AuthContextValue = AuthState & {
  loginAs: (role: Role) => void
  logout: () => void
  updateProfile: (patch: Partial<Omit<UserProfile, 'role'>>) => void
  hasAnyRole: (roles: Role[]) => boolean
}

const STORAGE_KEY = 'fps_mock_jwt'

const AuthContext = createContext<AuthContextValue | null>(null)

function base64UrlEncode(input: string) {
  return btoa(unescape(encodeURIComponent(input))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecode(input: string) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=')
  return decodeURIComponent(escape(atob(padded)))
}

type JwtPayload = {
  sub: string
  name: string
  email: string
  role: Role
  iat: number
}

function createMockJwt(payload: JwtPayload) {
  const header = { alg: 'none', typ: 'JWT' }
  return `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}.mock`
}

function parseMockJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const payloadJson = base64UrlDecode(parts[1]!)
    const payload = JSON.parse(payloadJson) as JwtPayload
    if (!payload?.role) return null
    return payload
  } catch {
    return null
  }
}

function readInitialAuth(): AuthState {
  try {
    const token = localStorage.getItem(STORAGE_KEY)
    if (!token) return { token: null, user: null }
    const payload = parseMockJwt(token)
    if (!payload) return { token: null, user: null }
    return {
      token,
      user: { name: payload.name, email: payload.email, role: payload.role },
    }
  } catch {
    return { token: null, user: null }
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(() => readInitialAuth())

  const value: AuthContextValue = useMemo(
    () => ({
      ...state,
      loginAs: (role) => {
        const payload: JwtPayload = {
          sub: 'u_001',
          name: role === 'admin' ? 'Admin User' : role === 'expert' ? 'Flood Expert' : 'Standard User',
          email: role === 'admin' ? 'admin@fps.local' : role === 'expert' ? 'expert@fps.local' : 'user@fps.local',
          role,
          iat: Math.floor(Date.now() / 1000),
        }
        const token = createMockJwt(payload)
        localStorage.setItem(STORAGE_KEY, token)
        setState({ token, user: { name: payload.name, email: payload.email, role: payload.role } })
      },
      logout: () => {
        localStorage.removeItem(STORAGE_KEY)
        setState({ token: null, user: null })
      },
      updateProfile: (patch) => {
        setState((s) => (s.user ? { ...s, user: { ...s.user, ...patch } } : s))
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

