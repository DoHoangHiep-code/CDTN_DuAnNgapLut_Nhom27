import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { LogOut, ShieldCheck } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useSettings } from '../context/SettingsContext'
import { cn } from '../utils/cn'
import { BRAND_ICON, NAV_ITEMS } from '../utils/nav'
import { NewsTicker, type NewsTickerItem } from '../components/NewsTicker'
import { useTranslation } from 'react-i18next'

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
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 py-5 lg:grid-cols-[260px_1fr]">
        <aside className="fps-card p-4 lg:sticky lg:top-5 lg:h-[calc(100dvh-40px)]">
          <div className="mb-4 flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-sky-600 text-white dark:bg-sky-500">
              <BrandIcon className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
                {t('sidebar.brand')}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{t('sidebar.systemUi')}</div>
            </div>
          </div>

          <nav className="space-y-1">
            {NAV_ITEMS.filter((i) => (user ? i.roles.includes(user.role) : false)).map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.key}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition',
                      isActive
                        ? 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-200'
                        : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800',
                    )
                  }
                >
                  <Icon className="h-4 w-4" />
                  {t(item.labelKey)}
                </NavLink>
              )
            })}
          </nav>

          <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
            <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-950/40">
              <div>
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">{user?.name ?? '-'}</div>
                <div className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {user?.role ?? 'guest'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  logout()
                  navigate('/login')
                }}
                className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                aria-label="Logout"
                title="Logout"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-800">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{t('sidebar.theme')}</span>
              <button
                type="button"
                onClick={toggleTheme}
                className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                {theme === 'dark' ? t('sidebar.dark') : t('sidebar.light')}
              </button>
            </div>
          </div>
        </aside>

        <main className="space-y-5">
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

          <div className="fps-card p-4 sm:p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}

