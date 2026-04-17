import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'

// ---------- Kiểu dữ liệu ----------
type ThemeMode = 'light' | 'dark'

// Đã loại bỏ apiBaseUrl khỏi state:
// API base URL phải được cấu hình qua biến môi trường (VITE_API_BASE_URL)
// để tránh người dùng tự thay đổi endpoint – rủi ro bảo mật.
type SettingsState = {
  theme: ThemeMode
  floodAlertsEnabled: boolean
}

type SettingsContextValue = SettingsState & {
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
  setFloodAlertsEnabled: (enabled: boolean) => void
}

// ---------- Hằng số ----------
const STORAGE_KEY = 'fps_settings_v1'

const DEFAULTS: SettingsState = {
  theme: 'light',
  floodAlertsEnabled: true,
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

// ---------- Đọc dữ liệu từ localStorage ----------
function readStored(): SettingsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as Partial<SettingsState>
    return {
      // Bỏ qua trường apiBaseUrl cũ nếu còn sót lại trong localStorage
      theme: parsed.theme === 'dark' || parsed.theme === 'light' ? parsed.theme : DEFAULTS.theme,
      floodAlertsEnabled:
        typeof parsed.floodAlertsEnabled === 'boolean'
          ? parsed.floodAlertsEnabled
          : DEFAULTS.floodAlertsEnabled,
    }
  } catch {
    return DEFAULTS
  }
}

// ---------- Áp dụng theme lên thẻ <html> ----------
// Tách thành hàm riêng để gọi được cả trong useEffect và khởi tạo ban đầu.
function applyTheme(theme: ThemeMode) {
  const root = document.documentElement
  if (theme === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}

// ---------- Provider ----------
export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SettingsState>(() => {
    const stored = readStored()
    // Áp dụng theme ngay khi khởi tạo để đồng bộ với script chống FOUC ở index.html
    applyTheme(stored.theme)
    return stored
  })

  // Đồng bộ class 'dark' mỗi khi theme thay đổi
  useEffect(() => {
    applyTheme(state.theme)
  }, [state.theme])

  // Lưu toàn bộ settings vào localStorage mỗi khi state thay đổi
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  const value: SettingsContextValue = useMemo(
    () => ({
      ...state,
      // Đặt theme cụ thể
      setTheme: (theme) => setState((s) => ({ ...s, theme })),
      // Chuyển đổi qua lại giữa light/dark
      toggleTheme: () =>
        setState((s) => ({ ...s, theme: s.theme === 'dark' ? 'light' : 'dark' })),
      // Cập nhật trạng thái bật/tắt cảnh báo ngập lụt
      setFloodAlertsEnabled: (enabled) => setState((s) => ({ ...s, floodAlertsEnabled: enabled })),
    }),
    [state],
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

// ---------- Hook tiện ích ----------
export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings phải được dùng bên trong SettingsProvider')
  return ctx
}
