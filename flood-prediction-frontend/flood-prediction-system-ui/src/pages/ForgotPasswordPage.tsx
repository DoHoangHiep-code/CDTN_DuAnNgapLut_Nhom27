import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import { authForgotPassword } from '../services/api'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)

  return (
    <div className="min-h-dvh bg-gradient-to-b from-sky-50 to-emerald-50 px-4 py-10 dark:from-slate-950 dark:to-slate-950">
      <div className="mx-auto max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">Quên mật khẩu</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Nhập email để nhận link đặt lại mật khẩu (DEV: link in ra terminal backend).
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

          <Button
            className="w-full"
            disabled={loading}
            onClick={async () => {
              // Validate cơ bản để tránh gửi request rỗng
              if (!email.trim()) {
                toast.error('Vui lòng nhập email.')
                return
              }
              setLoading(true)
              try {
                const res = await authForgotPassword({ email: email.trim() })
                toast.success(res.message || 'Đã gửi yêu cầu đặt lại mật khẩu.')
              } catch (e: any) {
                const msg = e?.response?.data?.error?.message || e?.response?.data?.message || 'Gửi yêu cầu thất bại'
                toast.error(String(msg))
              } finally {
                setLoading(false)
              }
            }}
          >
            {loading ? 'Đang gửi…' : 'Gửi link đặt lại mật khẩu'}
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

