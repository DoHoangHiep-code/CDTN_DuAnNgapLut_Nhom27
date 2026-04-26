import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { LogOut, ShieldCheck, UserCircle2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useSettings } from '../context/SettingsContext'
import { cn } from '../utils/cn'
import { BRAND_ICON, NAV_ITEMS } from '../utils/nav'
import { NewsTicker, type NewsTickerItem } from '../components/NewsTicker'
import { useTranslation } from 'react-i18next'
import { FloatingChatBotIcon } from '../components/FloatingChatBotIcon'

export function MainLayout() {
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useSettings()
  const navigate = useNavigate()
  const BrandIcon = BRAND_ICON
  const { t, i18n } = useTranslation()

  const newsItems: NewsTickerItem[] = [
    { id: 'n1', severity: 'danger', text: t('newsTicker.danger1') },
    { id: 'n2', severity: 'warning', text: t('newsTicker.warning1') },
    { id: 'n3', severity: 'info', text: t('newsTicker.info1') },
  ]

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-50 dark:bg-slate-950">
      {/* Sidebar — gradient xanh chủ đề nước */}
      <aside className="relative flex w-64 flex-shrink-0 flex-col overflow-hidden">
        {/* Nền gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-sky-700 via-sky-800 to-blue-900" />
        {/* Decoration sóng nước phía dưới */}
        <svg className="absolute bottom-0 left-0 w-full opacity-10" viewBox="0 0 256 80" preserveAspectRatio="none">
          <path d="M0 40 Q32 10 64 40 Q96 70 128 40 Q160 10 192 40 Q224 70 256 40 L256 80 L0 80 Z" fill="white" />
          <path d="M0 55 Q32 30 64 55 Q96 80 128 55 Q160 30 192 55 Q224 80 256 55 L256 80 L0 80 Z" fill="white" />
        </svg>

        <div className="relative flex flex-1 flex-col overflow-y-auto p-4">
          {/* Brand */}
          <div className="mb-6 flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-white/20 backdrop-blur ring-1 ring-white/30">
              <BrandIcon className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="text-sm font-extrabold tracking-tight text-white">
                {t('sidebar.brand')}
              </div>
              <div className="text-xs text-sky-200/70">{t('sidebar.systemUi')}</div>
            </div>
          </div>

          {/* Divider */}
          <div className="mb-3 h-px bg-white/10" />

          {/* Nav */}
          <nav className="space-y-1">
            {NAV_ITEMS.filter((i) => (user ? i.roles.includes(user.role) : false)).map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.key}
                  to={item.to}
                  end={item.to === '/dashboard'}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all duration-150',
                      isActive
                        ? 'bg-white/20 text-white shadow-sm ring-1 ring-white/20'
                        : 'text-sky-100/80 hover:bg-white/10 hover:text-white',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span className={cn(
                        'grid h-7 w-7 place-items-center rounded-lg transition-all',
                        isActive ? 'bg-white/20' : 'bg-transparent',
                      )}>
                        <Icon className="h-4 w-4" />
                      </span>
                      {t(item.labelKey)}
                    </>
                  )}
                </NavLink>
              )
            })}
          </nav>

          <div className="mt-auto pt-4">
            <div className="h-px bg-white/10 mb-4" />

            {/* User info */}
            <div className="flex items-center justify-between gap-2 rounded-xl bg-white/10 px-3 py-2.5 ring-1 ring-white/10">
              <div className="flex items-center gap-2 min-w-0">
                {user?.avatar_url ? (
                  <img
                    src={user.avatar_url}
                    alt="avatar"
                    className="h-8 w-8 rounded-xl object-cover ring-1 ring-white/30"
                  />
                ) : (
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-white/20 ring-1 ring-white/20">
                    <UserCircle2 className="h-4 w-4 text-white" />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="truncate text-xs font-bold text-white">{user?.full_name ?? '-'}</div>
                  <div className="flex items-center gap-1 text-[11px] text-sky-200/70">
                    <ShieldCheck className="h-3 w-3" />
                    {user?.role ?? 'guest'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { logout(); navigate('/login') }}
                className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white transition"
                aria-label="Logout"
                title="Logout"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>

            {/* Theme toggle */}
            <div className="mt-2 flex items-center justify-between rounded-xl bg-white/10 px-3 py-2 ring-1 ring-white/10">
              <span className="text-xs font-semibold text-sky-100/80">{t('sidebar.theme')}</span>
              <button
                type="button"
                onClick={toggleTheme}
                className="rounded-lg bg-white/20 px-2.5 py-1 text-xs font-bold text-white hover:bg-white/30 transition"
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
          <header className="fps-card flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{t('app.brand')}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{t('app.subtitle')}</div>
            </div>
            <div className="flex items-center gap-2">
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

          <NewsTicker items={newsItems} />

          <div className="fps-card flex-1 p-4 sm:p-6 mb-8">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  )
}

