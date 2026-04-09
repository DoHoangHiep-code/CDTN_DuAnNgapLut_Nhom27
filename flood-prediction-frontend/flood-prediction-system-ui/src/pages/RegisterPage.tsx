import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ShieldCheck } from 'lucide-react'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import { authRegister } from '../services/api'

export function RegisterPage() {
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  return (
    <div className="min-h-dvh bg-gradient-to-b from-sky-50 to-emerald-50 px-4 py-10 dark:from-slate-950 dark:to-slate-950">
      <div className="mx-auto max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-sky-600 text-white dark:bg-sky-500">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">Đăng ký</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Tạo tài khoản mới để sử dụng hệ thống.</p>
        </div>

        <Card className="p-6 space-y-3">
          {/* Khối nhập họ tên */}
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-200">Họ và tên</span>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-sky-500 dark:focus:ring-sky-900/40"
            />
          </label>

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

          <Button
            className="w-full mt-2"
            disabled={loading}
            onClick={async () => {
              // Validate phía client để UX tốt hơn (backend vẫn validate để bảo mật)
              if (!fullName.trim() || !email.trim() || !password) {
                toast.error('Vui lòng nhập đầy đủ thông tin.')
                return
              }

              setLoading(true)
              try {
                // Gọi API register thật
                // Backend có thể tự sinh username từ email, nhưng gửi kèm để tránh trùng và debug dễ hơn
                const username = email.trim().split('@')[0] || email.trim()
                await authRegister({ username, full_name: fullName.trim(), email: email.trim(), password })
                toast.success('Đăng ký thành công. Vui lòng đăng nhập.')
                navigate('/login')
              } catch (e: any) {
                const msg = e?.response?.data?.error?.message || e?.response?.data?.message || 'Đăng ký thất bại'
                toast.error(String(msg))
              } finally {
                setLoading(false)
              }
            }}
          >
            {loading ? 'Đang đăng ký…' : 'Đăng ký'}
          </Button>

          <div className="text-xs text-slate-600 dark:text-slate-300">
            Đã có tài khoản?{' '}
            <Link className="font-bold text-sky-700 dark:text-sky-300" to="/login">
              Đăng nhập
            </Link>
          </div>
        </Card>
      </div>
    </div>
  )
}

