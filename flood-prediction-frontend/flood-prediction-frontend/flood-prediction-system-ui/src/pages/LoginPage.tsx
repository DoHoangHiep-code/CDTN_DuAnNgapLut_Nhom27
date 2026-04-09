import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { useAuth } from '../context/AuthContext'
import type { Role } from '../utils/types'
import { useTranslation } from 'react-i18next'

export function LoginPage() {
  const { t } = useTranslation()
  const { user, loginAs } = useAuth()
  const navigate = useNavigate()
  const [role, setRole] = useState<Role>('user')

  if (user) return <Navigate to="/" replace />

  return (
    <div className="min-h-dvh bg-gradient-to-b from-sky-50 to-emerald-50 px-4 py-10 dark:from-slate-950 dark:to-slate-950">
      <div className="mx-auto max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-sky-600 text-white dark:bg-sky-500">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
            {t('login.title')}
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            {t('login.hint')}
          </p>
        </div>

        <Card className="p-6">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-200">{t('login.role')}</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-sky-500 dark:focus:ring-sky-900/40"
            >
              <option value="user">user (Dashboard / Map / Weather)</option>
              <option value="expert">expert (+ Reports)</option>
              <option value="admin">admin (all pages)</option>
            </select>
          </label>

          <div className="mt-4 flex gap-2">
            <Button
              className="flex-1"
              onClick={() => {
                loginAs(role)
                toast.success('Signed in')
                navigate('/')
              }}
            >
              {t('login.signIn')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                localStorage.clear()
                toast('Local storage cleared')
              }}
            >
              {t('login.reset')}
            </Button>
          </div>

          <div className="mt-4 text-xs text-slate-500 dark:text-slate-400">
            {t('login.tip')}
          </div>
        </Card>
      </div>
    </div>
  )
}

