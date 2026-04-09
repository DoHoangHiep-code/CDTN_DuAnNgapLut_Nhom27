import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'

type ThemeMode = 'light' | 'dark'

type SettingsState = {
  apiBaseUrl: string
  theme: ThemeMode
  floodAlertsEnabled: boolean
}

type SettingsContextValue = SettingsState & {
  setApiBaseUrl: (url: string) => void
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
  setFloodAlertsEnabled: (enabled: boolean) => void
}

const STORAGE_KEY = 'fps_settings_v1'

const DEFAULTS: SettingsState = {
  apiBaseUrl: '',
  theme: 'light',
  floodAlertsEnabled: true,
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

function readStored(): SettingsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as Partial<SettingsState>
    return {
      apiBaseUrl: typeof parsed.apiBaseUrl === 'string' ? parsed.apiBaseUrl : DEFAULTS.apiBaseUrl,
      theme: parsed.theme === 'dark' || parsed.theme === 'light' ? parsed.theme : DEFAULTS.theme,
      floodAlertsEnabled:
        typeof parsed.floodAlertsEnabled === 'boolean' ? parsed.floodAlertsEnabled : DEFAULTS.floodAlertsEnabled,
    }
  } catch {
    return DEFAULTS
  }
}

function applyTheme(theme: ThemeMode) {
  const root = document.documentElement
  if (theme === 'dark') root.classList.add('dark')
  else root.classList.remove('dark')
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SettingsState>(() => readStored())

  useEffect(() => {
    applyTheme(state.theme)
  }, [state.theme])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  const value: SettingsContextValue = useMemo(
    () => ({
      ...state,
      setApiBaseUrl: (url) => setState((s) => ({ ...s, apiBaseUrl: url.trim() })),
      setTheme: (theme) => setState((s) => ({ ...s, theme })),
      toggleTheme: () => setState((s) => ({ ...s, theme: s.theme === 'dark' ? 'light' : 'dark' })),
      setFloodAlertsEnabled: (enabled) => setState((s) => ({ ...s, floodAlertsEnabled: enabled })),
    }),
    [state],
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider')
  return ctx
}

