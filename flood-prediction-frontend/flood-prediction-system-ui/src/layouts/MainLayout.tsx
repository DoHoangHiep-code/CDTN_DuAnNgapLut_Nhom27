import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { LogOut, ShieldCheck, UserCircle2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useSettings } from '../context/SettingsContext'
import { cn } from '../utils/cn'
import { BRAND_ICON, NAV_ITEMS } from '../utils/nav'
import { NewsTicker, type NewsTickerItem } from '../components/common/NewsTicker'
import { useTranslation } from 'react-i18next'
import { FloatingChatBotIcon } from '../components/common/FloatingChatBotIcon'
import { HazardSwitcher } from '../components/common/HazardSwitcher'
import { useDisasterMode } from '../context/DisasterContext'
import { getDynamicAlerts } from '../services/api'

function buildTickerItems(alertsData: Array<{ district: string; max_depth: number; time: string }>): NewsTickerItem[] {
  if (!alertsData.length) {
    const timeStr = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    return [{
      id: 'safe_status',
      severity: 'info',
      text: `✅ Cập nhật ${timeStr}: Hệ thống hoạt động ổn định. Không có cảnh báo ngập lụt trong 24h tới.`
    }]
  }

  // Nối các thông báo lại với nhau hoặc trả về nhiều item
  const items: NewsTickerItem[] = alertsData.map((item, idx) => ({
    id: `alert_${item.district}_${idx}`,
    severity: 'danger',
    text: `⚠️ CẢNH BÁO: Quận ${item.district} dự báo ngập ${item.max_depth}cm vào lúc ${item.time}. Hãy chú ý di chuyển!`
  }))

  return items
}

const LANDSLIDE_TICKER_ITEMS: NewsTickerItem[] = [
  {
    id: 'ls_1',
    severity: 'danger',
    text: '⚠️ CẢNH BÁO ĐỎ: Nền đất tại Mù Cang Chải đã bão hòa nước — độ ẩm đất 88%. Nguy cơ sạt lở, trượt lở đất đá ở mức RẤT CAO trong 24h tới. Người dân vùng thấp cần di chuyển khẩn!',
  },
  {
    id: 'ls_2',
    severity: 'warning',
    text: '🟠 Hoàng Su Phì (Hà Giang): Mưa lớn kéo dài 7 ngày liên tiếp (142mm). Cảnh báo trượt lở dọc Quốc lộ 34. Cẩn trọng khi lưu thông qua các đèo.',
  },
  {
    id: 'ls_3',
    severity: 'danger',
    text: '🔴 Mường Tè (Lai Châu): Độ dốc địa hình 40°, phủ thực vật thưa (NDVI 0.35) kết hợp mưa lớn 163mm/7 ngày — rủi ro sạt lở nghiêm trọng. Bộ đội đang sẵn sàng ứng phó.',
  },
  {
    id: 'ls_4',
    severity: 'warning',
    text: '🟠 Sa Pa (Lào Cai): Đất đã ngậm nước 71%, mưa tích lũy 118mm. Nguy cơ sụt lún đất trong các khu vực canh tác ruộng bậc thang. Theo dõi chặt tình hình.',
  },
]

export function MainLayout() {
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useSettings()
  const navigate = useNavigate()
  const BrandIcon = BRAND_ICON
  const { t, i18n } = useTranslation()
  const { mode } = useDisasterMode()

  const [alertsData, setAlertsData] = useState<Array<{ district: string; max_depth: number; time: string }>>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const data = await getDynamicAlerts()
        if (!cancelled) setAlertsData(data)
      } catch {
        // Không crash layout nếu API lỗi
      }
    }
    load()
    const id = window.setInterval(load, 5 * 60 * 1000)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [])

  const newsItems: NewsTickerItem[] =
    mode === 'landslide'
      ? LANDSLIDE_TICKER_ITEMS
      : alertsData
        ? buildTickerItems(alertsData)
        : []

  const getAvatarUrl = (url?: string) => {
    if (!url) return null
    if (url.startsWith('http')) return url
    const apiUrl = (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:3002/api/v1'
    const baseUrl = apiUrl.replace(/\/api\/v1\/?$/, '')
    return `${baseUrl.replace(/\/+$/, '')}${url}`
  }

  const userAvatar = getAvatarUrl(user?.avatar_url ?? undefined)

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-50 dark:bg-slate-950">
      {/* Sidebar — đổi theme theo mode thiên tai */}
      <aside className="relative flex w-[280px] flex-shrink-0 flex-col overflow-hidden m-4 rounded-3xl shadow-2xl ring-1 ring-white/10 transition-all duration-500 z-10">
        {/* Nền gradient: xanh nước (flood) hoặc nâu đất (landslide) */}
        <div
          className="absolute inset-0 transition-all duration-700"
          style={mode === 'landslide'
            ? { background: 'linear-gradient(180deg, #291506 0%, #432009 50%, #1a0d04 100%)' }
            : { background: 'linear-gradient(180deg, #082f49 0%, #172554 50%, #020617 100%)' }
          }
        />
        {/* Noise overlay */}
        <div className="absolute inset-0 bg-[url('/noise.svg')] opacity-[0.03] mix-blend-overlay" />

        {/* Decoration: núi (landslide) hoặc sóng nước (flood) */}
        {mode === 'landslide' ? (
          <svg className="absolute bottom-0 left-0 w-full opacity-10" viewBox="0 0 256 80" preserveAspectRatio="none">
            <path d="M0 80 L40 35 L80 58 L130 18 L180 50 L220 28 L256 45 L256 80 Z" fill="#d97706" />
            <path d="M0 80 L60 50 L110 65 L160 38 L210 60 L256 42 L256 80 Z" fill="#92400e" />
          </svg>
        ) : (
          <svg className="absolute bottom-0 left-0 w-full opacity-10" viewBox="0 0 256 80" preserveAspectRatio="none">
            <path d="M0 40 Q32 10 64 40 Q96 70 128 40 Q160 10 192 40 Q224 70 256 40 L256 80 L0 80 Z" fill="white" />
            <path d="M0 55 Q32 30 64 55 Q96 80 128 55 Q160 30 192 55 Q224 80 256 55 L256 80 L0 80 Z" fill="white" />
          </svg>
        )}

        <div className="relative flex flex-1 flex-col overflow-y-auto p-5">
          {/* Brand */}
          <div className="mb-8 flex items-center gap-3">
            <div
              className="grid h-12 w-12 place-items-center rounded-2xl backdrop-blur-md ring-1 ring-white/30 shadow-lg shadow-black/20"
              style={{ background: mode === 'landslide' ? 'rgba(217,119,6,0.3)' : 'rgba(6,182,212,0.3)' }}
            >
              <BrandIcon className="h-6 w-6 text-white drop-shadow-md" />
            </div>
            <div>
              <div className="text-base font-black tracking-tight text-white drop-shadow-sm">
                {mode === 'landslide' ? 'Landslide Alert' : t('sidebar.brand')}
              </div>
              <div
                className="text-[11px] font-bold uppercase tracking-wider transition-colors duration-500"
                style={{ color: mode === 'landslide' ? 'rgba(251,191,36,0.8)' : 'rgba(165,243,252,0.8)' }}
              >
                {mode === 'landslide' ? 'Cảnh báo Sạt lở' : t('sidebar.systemUi')}
              </div>
            </div>
          </div>

          {/* Divider */}
          <div
            className="mb-3 h-px transition-colors duration-500"
            style={{ background: mode === 'landslide' ? 'rgba(217,119,6,0.2)' : 'rgba(255,255,255,0.1)' }}
          />

          {/* Mode badge */}
          <div
            className="mb-4 flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-black uppercase tracking-widest shadow-sm backdrop-blur-md transition-all duration-500"
            style={{ 
              background: mode === 'landslide' ? 'rgba(217,119,6,0.15)' : 'rgba(6,182,212,0.15)', 
              border: `1px solid ${mode === 'landslide' ? 'rgba(217,119,6,0.3)' : 'rgba(6,182,212,0.3)'}`, 
              color: mode === 'landslide' ? '#fcd34d' : '#a5f3fc' 
            }}
          >
            <span className={cn(
              "h-2 w-2 rounded-full animate-pulse shadow-[0_0_8px_currentColor]",
              mode === 'landslide' ? "bg-amber-400" : "bg-cyan-400"
            )} />
            {mode === 'landslide' ? 'Chế độ: Sạt lở' : 'Chế độ: Ngập lụt'}
          </div>

          {/* Nav */}
          <nav className="space-y-1">
            {NAV_ITEMS
              .filter((i) => (user ? i.roles.includes(user.role) : false))
              .map((item) => {
                const Icon = item.icon
                // Đổi label theo mode sạt lở
                const label = mode === 'landslide'
                  ? item.key === 'map'     ? 'Bản đồ sạt lở'
                  : item.key === 'weather' ? 'Thời tiết'
                  : item.key === 'reports' ? 'Báo cáo'
                  : t(item.labelKey)
                  : t(item.labelKey)

                return (
                  <NavLink
                    key={item.key}
                    to={item.to}
                    end={item.to === '/dashboard'}
                    className={({ isActive }) =>
                      cn(
                        'group flex items-center gap-3.5 rounded-2xl px-4 py-3.5 text-sm font-bold transition-all duration-300 relative overflow-hidden',
                        isActive 
                          ? 'text-white shadow-lg shadow-black/10 ring-1 ring-white/20 backdrop-blur-md' 
                          : 'hover:text-white hover:bg-white/10',
                      )
                    }
                    style={({ isActive }) => isActive
                      ? { 
                          background: mode === 'landslide' 
                            ? 'linear-gradient(90deg, rgba(217,119,6,0.4) 0%, rgba(217,119,6,0.05) 100%)' 
                            : 'linear-gradient(90deg, rgba(6,182,212,0.4) 0%, rgba(59,130,246,0.05) 100%)' 
                        }
                      : { color: mode === 'landslide' ? 'rgba(253,230,138,0.7)' : 'rgba(224,242,254,0.75)' }
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <div className="absolute left-0 top-1/2 h-1/2 w-1 -translate-y-1/2 rounded-r-full bg-white shadow-[0_0_10px_white]" />
                        )}
                        <span
                          className={cn(
                            "grid h-8 w-8 place-items-center rounded-xl transition-all duration-300",
                            isActive ? "bg-white/20 shadow-inner" : "bg-transparent group-hover:scale-110 group-hover:bg-white/10"
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        {label}
                      </>
                    )}
                  </NavLink>
                )
              })}
          </nav>

          <div className="mt-auto pt-4">
            <div
              className="h-px mb-4 transition-colors duration-500"
              style={{ background: mode === 'landslide' ? 'rgba(217,119,6,0.18)' : 'rgba(255,255,255,0.1)' }}
            />

            {/* User info */}
            <div
              className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3.5 ring-1 ring-white/10 backdrop-blur-md transition-all duration-300 hover:ring-white/20 shadow-lg shadow-black/10"
              style={{ background: mode === 'landslide' ? 'rgba(217,119,6,0.15)' : 'rgba(255,255,255,0.1)' }}
            >
              <div className="flex items-center gap-3 min-w-0">
                {userAvatar ? (
                  <img src={userAvatar} alt="avatar" className="h-10 w-10 rounded-xl object-cover ring-2 ring-white/20 shadow-md" />
                ) : (
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-white/20 to-white/5 ring-2 ring-white/20 shadow-md">
                    <UserCircle2 className="h-5 w-5 text-white" />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm font-extrabold text-white">{user?.full_name ?? '-'}</div>
                  <div
                    className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors duration-500 mt-0.5"
                    style={{ color: mode === 'landslide' ? 'rgba(251,191,36,0.8)' : 'rgba(165,243,252,0.8)' }}
                  >
                    <ShieldCheck className="h-3 w-3" />
                    {user?.role ?? 'guest'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { logout(); navigate('/login') }}
                className="grid h-8 w-8 place-items-center rounded-xl bg-white/5 text-white/60 transition-all hover:bg-rose-500 hover:text-white hover:shadow-lg hover:shadow-rose-500/30"
                aria-label="Logout"
                title="Logout"
              >
                <LogOut className="h-4 w-4 ml-0.5" />
              </button>
            </div>

            {/* Theme toggle */}
            <div
              className="mt-3 flex items-center justify-between rounded-2xl px-4 py-3 ring-1 ring-white/10 backdrop-blur-md shadow-lg shadow-black/5"
              style={{ background: mode === 'landslide' ? 'rgba(217,119,6,0.1)' : 'rgba(255,255,255,0.05)' }}
            >
              <span
                className="text-xs font-bold uppercase tracking-wider transition-colors duration-500"
                style={{ color: mode === 'landslide' ? 'rgba(253,230,138,0.7)' : 'rgba(224,242,254,0.8)' }}
              >
                {t('sidebar.theme')}
              </span>
              <button
                type="button"
                onClick={toggleTheme}
                className="rounded-xl bg-white/20 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-white/30 hover:scale-105 active:scale-95 transition-all shadow-sm"
              >
                {theme === 'dark' ? t('sidebar.dark') : t('sidebar.light')}
              </button>
            </div>
          </div>
        </div>
      </aside>

      <FloatingChatBotIcon />

      <main className="flex w-full min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex flex-1 flex-col space-y-5 p-4 sm:p-5">
          <header className="fps-card relative flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
            {/* Left: title đổi theo mode */}
            <div>
              <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {mode === 'landslide' ? 'Hệ thống Cảnh báo Sạt lở' : t('app.brand')}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {mode === 'landslide'
                  ? 'Dự báo sạt lở real-time · Miền Bắc Việt Nam'
                  : t('app.subtitle')}
              </div>
            </div>

            {/* Center: HazardSwitcher */}
            <div className="absolute left-1/2 -translate-x-1/2 hidden sm:block">
              <HazardSwitcher />
            </div>
            {/* Mobile: show inline */}
            <div className="sm:hidden">
              <HazardSwitcher />
            </div>

            <div className="flex items-center gap-2">
              <div className="mx-1 h-6 w-px bg-slate-200 dark:bg-slate-700" />

              <button
                type="button"
                onClick={() => {
                  const next = i18n.language === 'vi' ? 'en' : 'vi'
                  void i18n.changeLanguage(next)
                  try {
                    localStorage.setItem('fps_lang', next)
                  } catch {
                    // ignore
                  }
                }}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm backdrop-blur transition hover:-translate-y-[1px] hover:shadow-md dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-100 dark:hover:bg-slate-800/60"
                aria-label="Toggle Language"
                title="Toggle Language"
              >
                {i18n.language === 'vi' ? 'VI' : 'EN'}
              </button>
              <button
                type="button"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                onClick={() => navigate('/profile')}
              >
                {user?.email ?? '—'}
              </button>
            </div>
          </header>

          <NewsTicker items={newsItems} mode={mode} />

          <div className="fps-card flex-1 p-4 sm:p-6 mb-8">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  )
}

