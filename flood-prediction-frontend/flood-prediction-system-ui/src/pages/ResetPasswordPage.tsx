import { useMemo, useState } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import { authResetPassword } from '../services/api'

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const tokenFromUrl = params.get('token') || ''

  const [newPassword, setNewPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const token = useMemo(() => tokenFromUrl.trim(), [tokenFromUrl])

  return (
    <div className="min-h-dvh bg-gradient-to-b from-sky-50 to-emerald-50 px-4 py-10 dark:from-slate-950 dark:to-slate-950">
      <div className="mx-auto max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">Đặt lại mật khẩu</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Nhập mật khẩu mới để hoàn tất.</p>
        </div>

        <Card className="p-6 space-y-3">
          {/* Hiển thị warning nếu thiếu token để user biết cần mở đúng link */}
          {!token ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
              Thiếu token. Vui lòng mở link reset password hợp lệ.
            </div>
          ) : null}

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-200">Mật khẩu mới</span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-sky-500 dark:focus:ring-sky-900/40"
            />
          </label>

          <Button
            className="w-full"
            disabled={loading || !token}
            onClick={async () => {
              // Validate cơ bản để tránh gọi API vô nghĩa
              if (!token) {
                toast.error('Thiếu token.')
                return
              }
              if (!newPassword) {
                toast.error('Vui lòng nhập mật khẩu mới.')
                return
              }

              setLoading(true)
              try {
                const res = await authResetPassword({ token, newPassword })
                toast.success(res.message || 'Đặt lại mật khẩu thành công.')
                navigate('/login')
              } catch (e: any) {
                const msg = e?.response?.data?.error?.message || e?.response?.data?.message || 'Đặt lại mật khẩu thất bại'
                toast.error(String(msg))
              } finally {
                setLoading(false)
              }
            }}
          >
            {loading ? 'Đang cập nhật…' : 'Cập nhật mật khẩu'}
          </Button>

          <div className="text-xs text-slate-600 dark:text-slate-300">
            <Link className="font-bold text-sky-700 dark:text-sky-300" to="/login">
              Quay lại đăng nhập
            </Link>
          </div>
        </Card>
      </div>
    </div>
  )
}

