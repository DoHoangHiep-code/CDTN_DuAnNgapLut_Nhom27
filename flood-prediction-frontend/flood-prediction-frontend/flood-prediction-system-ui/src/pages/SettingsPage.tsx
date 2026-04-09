import toast from 'react-hot-toast'
import { CardHeader, CardMeta, CardTitle } from '../components/Card'
import { Input } from '../components/Input'
import { Toggle } from '../components/Toggle'
import { useSettings } from '../context/SettingsContext'
import { useTranslation } from 'react-i18next'
import { GlassCard } from '../components/GlassCard'
import { Title3D } from '../components/Title3D'

export function SettingsPage() {
  const { t } = useTranslation()
  const { apiBaseUrl, setApiBaseUrl, theme, toggleTheme, floodAlertsEnabled, setFloodAlertsEnabled } = useSettings()

  return (
    <div className="space-y-5">
      <div>
        <Title3D>{t('settings.title')}</Title3D>
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('settings.hint')}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <GlassCard className="space-y-4">
          <CardHeader>
            <div>
              <CardTitle>{t('settings.appearance')}</CardTitle>
              <CardMeta>{t('settings.darkModeHint')}</CardMeta>
            </div>
          </CardHeader>
          <Toggle
            label={t('settings.darkMode')}
            checked={theme === 'dark'}
            onChange={() => toggleTheme()}
            hint={t('settings.darkModeHint')}
          />
        </GlassCard>

        <GlassCard className="space-y-4">
          <CardHeader>
            <div>
              <CardTitle>{t('settings.api')}</CardTitle>
              <CardMeta>{t('settings.apiHint')}</CardMeta>
            </div>
          </CardHeader>

          <Input
            label={t('settings.apiBaseUrl')}
            placeholder="e.g. http://localhost:8080"
            value={apiBaseUrl}
            onChange={(e) => setApiBaseUrl(e.target.value)}
            hint={t('settings.leaveEmptyApiHint')}
          />

          <button
            type="button"
            className="text-left text-xs font-semibold text-sky-700 hover:underline dark:text-sky-300"
            onClick={() => toast(t('settings.save'))}
          >
            {t('settings.save')}
          </button>
        </GlassCard>

        <GlassCard className="space-y-4 lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>{t('settings.notifications')}</CardTitle>
              <CardMeta>{t('settings.floodAlerts')}</CardMeta>
            </div>
          </CardHeader>
          <Toggle
            label={t('settings.floodAlerts')}
            checked={floodAlertsEnabled}
            onChange={setFloodAlertsEnabled}
            hint={t('settings.floodAlertsHint')}
          />
        </GlassCard>
      </div>
    </div>
  )
}

