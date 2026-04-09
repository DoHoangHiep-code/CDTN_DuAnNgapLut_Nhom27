import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { CardHeader, CardMeta, CardTitle } from '../components/Card'
import { Input } from '../components/Input'
import { Button } from '../components/Button'
import { useAuth } from '../context/AuthContext'
import { useTranslation } from 'react-i18next'
import { GlassCard } from '../components/GlassCard'
import { Title3D } from '../components/Title3D'

export function ProfilePage() {
  const { t } = useTranslation()
  const { user, updateProfile } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')

  useEffect(() => {
    setName(user?.name ?? '')
    setEmail(user?.email ?? '')
  }, [user])

  if (!user) return null

  return (
    <div className="space-y-5">
      <div>
        <Title3D>{t('profile.title')}</Title3D>
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('profile.hint')}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <GlassCard className="space-y-4">
          <CardHeader>
            <div>
              <CardTitle>{t('profile.account')}</CardTitle>
              <CardMeta>{t('profile.accountHint')}</CardMeta>
            </div>
          </CardHeader>

          <div className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-950/40">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{t('profile.role')}</span>
              <span className="text-xs font-extrabold text-slate-900 dark:text-slate-100">{user.role}</span>
            </div>
          </div>

          <Input label={t('profile.name')} value={name} onChange={(e) => setName(e.target.value)} />
          <Input label={t('profile.email')} value={email} onChange={(e) => setEmail(e.target.value)} />

          <div className="flex gap-2">
            <Button
              className="flex-1"
              onClick={() => {
                updateProfile({ name, email })
                toast.success('Profile updated (UI)')
              }}
            >
              {t('profile.saveChanges')}
            </Button>
            <Button
              className="flex-1"
              variant="ghost"
              onClick={() => {
                setName(user.name)
                setEmail(user.email)
              }}
            >
              {t('profile.reset')}
            </Button>
          </div>
        </GlassCard>

        <GlassCard className="space-y-3">
          <CardHeader>
            <div>
              <CardTitle>{t('profile.notes')}</CardTitle>
              <CardMeta>{t('profile.notesHint')}</CardMeta>
            </div>
          </CardHeader>
          <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700 dark:text-slate-200">
            <li>A mock JWT is stored in localStorage after login.</li>
            <li>Routes and sidebar items are filtered by role (user/expert/admin).</li>
            <li>To switch roles, log out and sign in again from the login page.</li>
          </ul>
        </GlassCard>
      </div>
    </div>
  )
}

