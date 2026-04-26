import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'

// ---------- Kiểu dữ liệu ----------
type ThemeMode = 'light' | 'dark'
export type Language = 'vi' | 'en'
export type MapStyle = 'streets' | 'satellite' | 'terrain'
export type RefreshInterval = 0 | 5 | 15 | 30 | 60

type SettingsState = {
  theme: ThemeMode
  floodAlertsEnabled: boolean
  language: Language
  showRiskOverlay: boolean
  showFloodMarkers: boolean
  mapStyle: MapStyle
  forecastRefreshInterval: RefreshInterval
  showFloodDepth: boolean
  showWeatherStats: boolean
  compactSidebar: boolean
}

type SettingsContextValue = SettingsState & {
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
  setFloodAlertsEnabled: (enabled: boolean) => void
  setLanguage: (lang: Language) => void
  setShowRiskOverlay: (v: boolean) => void
  setShowFloodMarkers: (v: boolean) => void
  setMapStyle: (s: MapStyle) => void
  setForecastRefreshInterval: (n: RefreshInterval) => void
  setShowFloodDepth: (v: boolean) => void
  setShowWeatherStats: (v: boolean) => void
  setCompactSidebar: (v: boolean) => void
}

// ---------- Hằng số ----------
const STORAGE_KEY = 'fps_settings_v2'

const DEFAULTS: SettingsState = {
  theme: 'light',
  floodAlertsEnabled: true,
  language: 'vi',
  showRiskOverlay: true,
  showFloodMarkers: true,
  mapStyle: 'streets',
  forecastRefreshInterval: 15,
  showFloodDepth: true,
  showWeatherStats: true,
  compactSidebar: false,
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

function readStored(): SettingsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const p = JSON.parse(raw) as Partial<SettingsState>
    return {
      theme: p.theme === 'dark' || p.theme === 'light' ? p.theme : DEFAULTS.theme,
      floodAlertsEnabled: typeof p.floodAlertsEnabled === 'boolean' ? p.floodAlertsEnabled : DEFAULTS.floodAlertsEnabled,
      language: p.language === 'vi' || p.language === 'en' ? p.language : DEFAULTS.language,
      showRiskOverlay: typeof p.showRiskOverlay === 'boolean' ? p.showRiskOverlay : DEFAULTS.showRiskOverlay,
      showFloodMarkers: typeof p.showFloodMarkers === 'boolean' ? p.showFloodMarkers : DEFAULTS.showFloodMarkers,
      mapStyle: ['streets', 'satellite', 'terrain'].includes(p.mapStyle ?? '') ? p.mapStyle! : DEFAULTS.mapStyle,
      forecastRefreshInterval: [0, 5, 15, 30, 60].includes(p.forecastRefreshInterval ?? -1) ? p.forecastRefreshInterval! : DEFAULTS.forecastRefreshInterval,
      showFloodDepth: typeof p.showFloodDepth === 'boolean' ? p.showFloodDepth : DEFAULTS.showFloodDepth,
      showWeatherStats: typeof p.showWeatherStats === 'boolean' ? p.showWeatherStats : DEFAULTS.showWeatherStats,
      compactSidebar: typeof p.compactSidebar === 'boolean' ? p.compactSidebar : DEFAULTS.compactSidebar,
    }
  } catch {
    return DEFAULTS
  }
}

function applyTheme(theme: ThemeMode) {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
}

// ---------- Provider ----------
export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SettingsState>(() => {
    const stored = readStored()
    applyTheme(stored.theme)
    return stored
  })

  useEffect(() => { applyTheme(state.theme) }, [state.theme])
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) }, [state])

  const value: SettingsContextValue = useMemo(() => ({
    ...state,
    setTheme: (theme) => setState((s) => ({ ...s, theme })),
    toggleTheme: () => setState((s) => ({ ...s, theme: s.theme === 'dark' ? 'light' : 'dark' })),
    setFloodAlertsEnabled: (enabled) => setState((s) => ({ ...s, floodAlertsEnabled: enabled })),
    setLanguage: (language) => setState((s) => ({ ...s, language })),
    setShowRiskOverlay: (showRiskOverlay) => setState((s) => ({ ...s, showRiskOverlay })),
    setShowFloodMarkers: (showFloodMarkers) => setState((s) => ({ ...s, showFloodMarkers })),
    setMapStyle: (mapStyle) => setState((s) => ({ ...s, mapStyle })),
    setForecastRefreshInterval: (forecastRefreshInterval) => setState((s) => ({ ...s, forecastRefreshInterval })),
    setShowFloodDepth: (showFloodDepth) => setState((s) => ({ ...s, showFloodDepth })),
    setShowWeatherStats: (showWeatherStats) => setState((s) => ({ ...s, showWeatherStats })),
    setCompactSidebar: (compactSidebar) => setState((s) => ({ ...s, compactSidebar })),
  }), [state])

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

// ---------- Hook tiện ích ----------
export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings phải được dùng bên trong SettingsProvider')
  return ctx
}
