import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { useAuth } from '../context/AuthContext'
import { useTranslation } from 'react-i18next'

export function LoginPage() {
  const { t } = useTranslation()
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

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

        <Card className="p-6 space-y-3">
          {/* Khối nhập email */}
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-200">Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-sky-500 dark:focus:ring-sky-900/40"
            />
          </label>

          {/* Khối nhập mật khẩu */}
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-200">Mật khẩu</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-sky-500 dark:focus:ring-sky-900/40"
            />
          </label>

          <div className="mt-4 flex gap-2">
            <Button
              className="flex-1"
              disabled={loading}
              onClick={async () => {
                // Validate để UX tốt và hiển thị lỗi rõ ràng
                if (!email.trim()) {
                  toast.error('Vui lòng nhập tên đăng nhập!')
                  return
                }
                if (!password) {
                  toast.error('Vui lòng nhập mật khẩu!')
                  return
                }

                setLoading(true)
                try {
                  // Gọi login thật (backend trả thông báo lỗi chính xác nếu sai)
                  await login({ email: email.trim(), password })
                  toast.success('Đăng nhập thành công')
                  navigate('/dashboard')
                } catch (e: any) {
                  const msg = e?.response?.data?.error?.message || e?.response?.data?.message || 'Đăng nhập thất bại'
                  toast.error(String(msg))
                } finally {
                  setLoading(false)
                }
              }}
            >
              {loading ? 'Đang đăng nhập…' : t('login.signIn')}
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

          <div className="mt-2 flex items-center justify-between text-xs">
            <Link className="font-bold text-sky-700 dark:text-sky-300" to="/forgot-password">
              Quên mật khẩu?
            </Link>
            <Link className="font-bold text-sky-700 dark:text-sky-300" to="/register">
              Tạo tài khoản
            </Link>
          </div>
        </Card>
      </div>
    </div>
  )
}

