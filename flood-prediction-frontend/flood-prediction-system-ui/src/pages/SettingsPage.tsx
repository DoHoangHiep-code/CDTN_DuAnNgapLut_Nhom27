import { useState } from 'react'
import toast from 'react-hot-toast'
import {
  Bell, BellOff, Moon, Palette, Settings2, Sun,
  Globe, Map, Layers, Thermometer, BarChart2, MapPin, Clock,
} from 'lucide-react'
import { Toggle } from '../components/Toggle'
import { useSettings, type MapStyle, type RefreshInterval, type Language } from '../context/SettingsContext'
import { useTranslation } from 'react-i18next'
import { updateUserSettings } from '../services/api'
import { cn } from '../utils/cn'

// ── Toggle row: icon + text on left, toggle on right ────────────────
function ToggleRow({
  icon, iconBg, title, description, checked, onChange, active,
}: {
  icon: React.ReactNode
  iconBg: string
  title: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
  active?: boolean
}) {
  return (
    <div className={cn(
      'flex items-center gap-4 p-4 transition-all',
      active
        ? 'bg-sky-50/60 dark:bg-sky-950/20'
        : 'hover:bg-slate-50/50 dark:hover:bg-slate-800/50',
    )}>
      <div className={cn('grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl', iconBg)}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{title}</div>
        <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 leading-snug">{description}</div>
      </div>
      <div className="flex-shrink-0">
        <Toggle label="" checked={checked} onChange={onChange} />
      </div>
    </div>
  )
}

// ── Select row: icon + text on top, pills below (full width) ─────────
function SelectRow<T extends string | number>({
  icon, iconBg, title, description, options, value, onChange,
}: {
  icon: React.ReactNode
  iconBg: string
  title: string
  description: string
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-4">
        <div className={cn('grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl', iconBg)}>
          {icon}
        </div>
        <div>
          <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{title}</div>
          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{description}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              'rounded-xl px-4 py-2 text-xs font-semibold transition-all border',
              value === opt.value
                ? 'bg-sky-500 text-white border-sky-500 shadow-sm'
                : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-sky-300 hover:text-sky-600 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Section header with divider ──────────────────────────────────────
function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 px-1 pb-1 pt-4">
      <div className="text-slate-400 dark:text-slate-500">{icon}</div>
      <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{title}</span>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────
export function SettingsPage() {
  const { t, i18n } = useTranslation()
  const {
    theme, toggleTheme,
    floodAlertsEnabled, setFloodAlertsEnabled,
    language, setLanguage,
    showRiskOverlay, setShowRiskOverlay,
    showFloodMarkers, setShowFloodMarkers,
    mapStyle, setMapStyle,
    forecastRefreshInterval, setForecastRefreshInterval,
    showFloodDepth, setShowFloodDepth,
    showWeatherStats, setShowWeatherStats,
  } = useSettings()

  const [alertsLoading, setAlertsLoading] = useState(false)

  async function handleAlertToggle(newValue: boolean) {
    if (alertsLoading) return
    const previousValue = floodAlertsEnabled
    setFloodAlertsEnabled(newValue)
    setAlertsLoading(true)
    try {
      await updateUserSettings({ floodAlertsEnabled: newValue })
      toast.success(newValue ? 'Đã bật cảnh báo ngập lụt ✅' : 'Đã tắt cảnh báo ngập lụt 🔕', { duration: 3000 })
    } catch (err: any) {
      setFloodAlertsEnabled(previousValue)
      const msg = err?.response?.data?.message ?? 'Không thể cập nhật cài đặt. Vui lòng thử lại.'
      toast.error(msg, { duration: 4000 })
    } finally {
      setAlertsLoading(false)
    }
  }

  function handleLanguageChange(lang: Language) {
    setLanguage(lang)
    void i18n.changeLanguage(lang)
    try { localStorage.setItem('fps_lang', lang) } catch { /* ignore */ }
    toast.success(lang === 'vi' ? 'Đã chuyển sang Tiếng Việt' : 'Switched to English', { duration: 2000 })
  }

  const refreshOptions: { value: RefreshInterval; label: string }[] = [
    { value: 0, label: t('settings.refreshOff') },
    { value: 5, label: t('settings.refresh5m') },
    { value: 15, label: t('settings.refresh15m') },
    { value: 30, label: t('settings.refresh30m') },
    { value: 60, label: t('settings.refresh60m') },
  ]

  const mapStyleOptions: { value: MapStyle; label: string }[] = [
    { value: 'streets', label: t('settings.mapStyleStreets') },
    { value: 'satellite', label: t('settings.mapStyleSatellite') },
    { value: 'terrain', label: t('settings.mapStyleTerrain') },
  ]

  const langOptions: { value: Language; label: string }[] = [
    { value: 'vi', label: t('settings.languageVi') },
    { value: 'en', label: t('settings.languageEn') },
  ]

  return (
    <div className="mx-auto max-w-6xl pb-8 px-4 sm:px-6 lg:px-8">

      {/* Page header */}
      <div className="flex items-center gap-4 mb-8">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 shadow-lg shadow-sky-200 dark:shadow-sky-900/40">
          <Settings2 className="h-6 w-6 text-white" />
        </div>
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
            {t('settings.title')}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('settings.hint')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        {/* ── Giao diện ── */}
      <div className="space-y-2">
        <SectionHeader icon={<Palette className="h-3.5 w-3.5" />} title={t('settings.appearance')} />
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800/80">
          <ToggleRow
            icon={theme === 'dark' ? <Moon className="h-5 w-5 text-indigo-400" /> : <Sun className="h-5 w-5 text-amber-500" />}
            iconBg={theme === 'dark' ? 'bg-indigo-100 dark:bg-indigo-900/40' : 'bg-amber-100 dark:bg-amber-900/40'}
            title={t('settings.darkMode')}
            description={t('settings.darkModeHint')}
            checked={theme === 'dark'}
            onChange={toggleTheme}
            active={theme === 'dark'}
          />
        </div>
      </div>

      {/* ── Ngôn ngữ ── */}
      <div className="space-y-2">
        <SectionHeader icon={<Globe className="h-3.5 w-3.5" />} title={t('settings.language')} />
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800/80">
          <SelectRow<Language>
            icon={<Globe className="h-5 w-5 text-violet-500" />}
            iconBg="bg-violet-100 dark:bg-violet-900/40"
            title={t('settings.language')}
            description={t('settings.languageHint')}
            options={langOptions}
            value={language}
            onChange={handleLanguageChange}
          />
        </div>
      </div>

      {/* ── Bản đồ ── */}
      <div className="space-y-2">
        <SectionHeader icon={<Map className="h-3.5 w-3.5" />} title={t('settings.sectionMap')} />
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800/80">
          <ToggleRow
            icon={<Layers className="h-5 w-5 text-emerald-500" />}
            iconBg="bg-emerald-100 dark:bg-emerald-900/40"
            title={t('settings.showRiskOverlay')}
            description={t('settings.showRiskOverlayHint')}
            checked={showRiskOverlay}
            onChange={setShowRiskOverlay}
            active={showRiskOverlay}
          />

          <ToggleRow
            icon={<MapPin className="h-5 w-5 text-rose-500" />}
            iconBg="bg-rose-100 dark:bg-rose-900/40"
            title={t('settings.showFloodMarkers')}
            description={t('settings.showFloodMarkersHint')}
            checked={showFloodMarkers}
            onChange={setShowFloodMarkers}
            active={showFloodMarkers}
          />

          <SelectRow<MapStyle>
            icon={<Map className="h-5 w-5 text-teal-500" />}
            iconBg="bg-teal-100 dark:bg-teal-900/40"
            title={t('settings.mapStyle')}
            description={t('settings.mapStyleHint')}
            options={mapStyleOptions}
            value={mapStyle}
            onChange={setMapStyle}
          />
        </div>
      </div>

      {/* ── Dự báo ── */}
      <div className="space-y-2">
        <SectionHeader icon={<BarChart2 className="h-3.5 w-3.5" />} title={t('settings.sectionForecast')} />
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800/80">
          <ToggleRow
            icon={<Thermometer className="h-5 w-5 text-orange-500" />}
            iconBg="bg-orange-100 dark:bg-orange-900/40"
            title={t('settings.showFloodDepth')}
            description={t('settings.showFloodDepthHint')}
            checked={showFloodDepth}
            onChange={setShowFloodDepth}
            active={showFloodDepth}
          />

          <ToggleRow
            icon={<BarChart2 className="h-5 w-5 text-blue-500" />}
            iconBg="bg-blue-100 dark:bg-blue-900/40"
            title={t('settings.showWeatherStats')}
            description={t('settings.showWeatherStatsHint')}
            checked={showWeatherStats}
            onChange={setShowWeatherStats}
            active={showWeatherStats}
          />

          <SelectRow<RefreshInterval>
            icon={<Clock className="h-5 w-5 text-sky-500" />}
            iconBg="bg-sky-100 dark:bg-sky-900/40"
            title={t('settings.forecastRefresh')}
            description={t('settings.forecastRefreshHint')}
            options={refreshOptions}
            value={forecastRefreshInterval}
            onChange={setForecastRefreshInterval}
          />
        </div>
      </div>

      {/* ── Thông báo ── */}
      <div className="space-y-2">
        <SectionHeader icon={<Bell className="h-3.5 w-3.5" />} title={t('settings.notifications')} />

        <div className={cn("overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800/80", alertsLoading && 'pointer-events-none opacity-50')}>
          <ToggleRow
            icon={floodAlertsEnabled
              ? <Bell className="h-5 w-5 text-sky-500" />
              : <BellOff className="h-5 w-5 text-slate-400" />}
            iconBg={floodAlertsEnabled ? 'bg-sky-100 dark:bg-sky-900/40' : 'bg-slate-100 dark:bg-slate-800'}
            title={t('settings.floodAlerts')}
            description={alertsLoading ? 'Đang cập nhật...' : t('settings.floodAlertsHint')}
            checked={floodAlertsEnabled}
            onChange={handleAlertToggle}
            active={floodAlertsEnabled}
          />
        </div>
      </div>

      </div>
    </div>
  )
}
