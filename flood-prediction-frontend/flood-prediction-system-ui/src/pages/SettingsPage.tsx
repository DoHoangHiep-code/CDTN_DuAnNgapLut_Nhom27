import { useState } from 'react'
import toast from 'react-hot-toast'
import {
  Bell, BellOff, Moon, Palette, Settings2, Sun,
  Globe, Map, Layers, Thermometer, BarChart2, MapPin, Clock,
} from 'lucide-react'
import { Toggle } from '../components/common/Toggle'
import { useSettings, type MapStyle, type RefreshInterval, type Language } from '../context/SettingsContext'
import { useTranslation } from 'react-i18next'
import { updateUserSettings } from '../services/api'
import { cn } from '../utils/cn'

// ── ToggleRow ────────────────────────────────────────────────────────
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
      'flex items-center gap-4 p-5 transition-all duration-300',
      active
        ? 'bg-cyan-50/40 dark:bg-cyan-900/10'
        : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/50',
    )}>
      <div className={cn('grid h-12 w-12 flex-shrink-0 place-items-center rounded-2xl shadow-sm', iconBg)}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-extrabold text-slate-800 dark:text-slate-100">{title}</div>
        <div className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400 leading-snug">{description}</div>
      </div>
      <div className="flex-shrink-0">
        <Toggle label="" checked={checked} onChange={onChange} />
      </div>
    </div>
  )
}

// ── SelectRow ────────────────────────────────────────────────────────
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
    <div className="p-5 space-y-4">
      <div className="flex items-center gap-4">
        <div className={cn('grid h-12 w-12 flex-shrink-0 place-items-center rounded-2xl shadow-sm', iconBg)}>
          {icon}
        </div>
        <div>
          <div className="text-sm font-extrabold text-slate-800 dark:text-slate-100">{title}</div>
          <div className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">{description}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        {options.map((opt) => (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              'rounded-xl px-4 py-2.5 text-xs font-bold transition-all border',
              value === opt.value
                ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white border-transparent shadow-md shadow-cyan-500/30'
                : 'bg-white/80 text-slate-600 border-slate-200/80 hover:border-cyan-400 hover:text-cyan-600 hover:shadow-sm dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 dark:hover:border-cyan-500 dark:hover:text-cyan-400',
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
    <div className="mx-auto w-full max-w-5xl pb-10">

      {/* Page header */}
      <div className="flex items-center gap-4 mb-8 px-1">
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 shadow-[0_8px_16px_-6px_rgba(6,182,212,0.5)] dark:shadow-[0_8px_16px_-6px_rgba(6,182,212,0.3)]">
          <Settings2 className="h-7 w-7 text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900 dark:text-slate-100">
            {t('settings.title')}
          </h2>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{t('settings.hint')}</p>
        </div>
      </div>

      {/* Container toàn bộ (View to) */}
      <div className="mt-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-12 gap-y-8 items-start">

          {/* --- CỘT TRÁI --- */}
          <div className="space-y-8">
            {/* ── Giao diện ── */}
            <div className="space-y-4">
              <SectionHeader icon={<Palette className="h-4 w-4 text-cyan-500" />} title={t('settings.appearance')} />
              <div className="overflow-hidden rounded-3xl border border-slate-200/60 bg-white/60 shadow-lg backdrop-blur-md dark:border-slate-800/60 dark:bg-slate-900/60 divide-y divide-slate-200/50 dark:divide-slate-800/50">
                <ToggleRow
                  icon={theme === 'dark' ? <Moon className="h-6 w-6 text-indigo-500" /> : <Sun className="h-6 w-6 text-amber-500" />}
                  iconBg={theme === 'dark' ? 'bg-indigo-100 dark:bg-indigo-900/40' : 'bg-amber-100 dark:bg-amber-900/40'}
                  title={t('settings.darkMode')}
                  description={t('settings.darkModeHint')}
                  checked={theme === 'dark'}
                  onChange={toggleTheme}
                  active={theme === 'dark'}
                />
              </div>
            </div>

            {/* ── Bản đồ ── */}
            <div className="space-y-4">
              <SectionHeader icon={<Map className="h-4 w-4 text-emerald-500" />} title={t('settings.sectionMap')} />
              <div className="overflow-hidden rounded-3xl border border-slate-200/60 bg-white/60 shadow-lg backdrop-blur-md dark:border-slate-800/60 dark:bg-slate-900/60 divide-y divide-slate-200/50 dark:divide-slate-800/50">
                <ToggleRow
                  icon={<Layers className="h-6 w-6 text-emerald-500" />}
                  iconBg="bg-emerald-100/80 dark:bg-emerald-900/40"
                  title={t('settings.showRiskOverlay')}
                  description={t('settings.showRiskOverlayHint')}
                  checked={showRiskOverlay}
                  onChange={setShowRiskOverlay}
                  active={showRiskOverlay}
                />
                <ToggleRow
                  icon={<MapPin className="h-6 w-6 text-rose-500" />}
                  iconBg="bg-rose-100/80 dark:bg-rose-900/40"
                  title={t('settings.showFloodMarkers')}
                  description={t('settings.showFloodMarkersHint')}
                  checked={showFloodMarkers}
                  onChange={setShowFloodMarkers}
                  active={showFloodMarkers}
                />
                <SelectRow<MapStyle>
                  icon={<Map className="h-6 w-6 text-teal-500" />}
                  iconBg="bg-teal-100/80 dark:bg-teal-900/40"
                  title={t('settings.mapStyle')}
                  description={t('settings.mapStyleHint')}
                  options={mapStyleOptions}
                  value={mapStyle}
                  onChange={setMapStyle}
                />
              </div>
            </div>


          </div>

          {/* --- CỘT PHẢI --- */}
          <div className="space-y-8">
            {/* ── Ngôn ngữ ── */}
            <div className="space-y-4">
              <SectionHeader icon={<Globe className="h-4 w-4 text-violet-500" />} title={t('settings.language')} />
              <div className="overflow-hidden rounded-3xl border border-slate-200/60 bg-white/60 shadow-lg backdrop-blur-md dark:border-slate-800/60 dark:bg-slate-900/60 divide-y divide-slate-200/50 dark:divide-slate-800/50">
                <SelectRow<Language>
                  icon={<Globe className="h-6 w-6 text-violet-500" />}
                  iconBg="bg-violet-100/80 dark:bg-violet-900/40"
                  title={t('settings.language')}
                  description={t('settings.languageHint')}
                  options={langOptions}
                  value={language}
                  onChange={handleLanguageChange}
                />
              </div>
            </div>

            {/* ── Dự báo ── */}
            <div className="space-y-4">
              <SectionHeader icon={<BarChart2 className="h-4 w-4 text-blue-500" />} title={t('settings.sectionForecast')} />
              <div className="overflow-hidden rounded-3xl border border-slate-200/60 bg-white/60 shadow-lg backdrop-blur-md dark:border-slate-800/60 dark:bg-slate-900/60 divide-y divide-slate-200/50 dark:divide-slate-800/50">
                <ToggleRow
                  icon={<Thermometer className="h-6 w-6 text-orange-500" />}
                  iconBg="bg-orange-100/80 dark:bg-orange-900/40"
                  title={t('settings.showFloodDepth')}
                  description={t('settings.showFloodDepthHint')}
                  checked={showFloodDepth}
                  onChange={setShowFloodDepth}
                  active={showFloodDepth}
                />
                <ToggleRow
                  icon={<BarChart2 className="h-6 w-6 text-blue-500" />}
                  iconBg="bg-blue-100/80 dark:bg-blue-900/40"
                  title={t('settings.showWeatherStats')}
                  description={t('settings.showWeatherStatsHint')}
                  checked={showWeatherStats}
                  onChange={setShowWeatherStats}
                  active={showWeatherStats}
                />
                <SelectRow<RefreshInterval>
                  icon={<Clock className="h-6 w-6 text-cyan-500" />}
                  iconBg="bg-cyan-100/80 dark:bg-cyan-900/40"
                  title={t('settings.forecastRefresh')}
                  description={t('settings.forecastRefreshHint')}
                  options={refreshOptions}
                  value={forecastRefreshInterval}
                  onChange={setForecastRefreshInterval}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
