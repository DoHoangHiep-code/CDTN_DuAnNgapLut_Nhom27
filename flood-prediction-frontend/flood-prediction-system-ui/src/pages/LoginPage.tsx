import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Waves, MountainSnow, ArrowRight, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
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
    <div className="relative min-h-dvh overflow-hidden bg-slate-950 flex items-center justify-center p-4 selection:bg-cyan-500/30">
      {/* ── Background Animations & Gradients ── */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        {/* Lớp nền tối */}
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900" />
        
        {/* Vệt sáng xanh dương (Ngập lụt - Nước) */}
        <div className="absolute top-[-20%] left-[-10%] h-[70%] w-[60%] rounded-full bg-cyan-700/20 blur-[120px] mix-blend-screen" />
        <div className="absolute top-[20%] left-[10%] h-[40%] w-[40%] rounded-full bg-blue-600/10 blur-[100px] mix-blend-screen" />

        {/* Vệt sáng cam/nâu (Sạt lở - Đất đá) */}
        <div className="absolute bottom-[-20%] right-[-10%] h-[70%] w-[60%] rounded-full bg-amber-700/20 blur-[120px] mix-blend-screen" />
        <div className="absolute bottom-[20%] right-[10%] h-[40%] w-[40%] rounded-full bg-orange-600/10 blur-[100px] mix-blend-screen" />
        
        {/* Overlay lưới mờ tạo cảm giác công nghệ */}
        <div className="absolute inset-0 bg-[url('/noise.svg')] opacity-20 mix-blend-overlay" />
      </div>

      {/* ── Main Content ── */}
      <div className="relative z-10 w-full max-w-md">
        
        {/* Header (Logo + Title) */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-white/5 shadow-2xl backdrop-blur-md ring-1 ring-white/20">
            <div className="flex -space-x-2">
              <Waves className="h-8 w-8 text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
              <MountainSnow className="h-8 w-8 text-amber-500 drop-shadow-[0_0_8px_rgba(245,158,11,0.8)]" />
            </div>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white drop-shadow-sm">
            {t('login.title')}
          </h1>
          <p className="mt-2 text-sm font-medium text-slate-300">
            Hệ thống Giám sát & Dự báo Nguy cơ Cấp cao
          </p>
        </div>

        {/* Form Card (Glassmorphism) */}
        <div className="overflow-hidden rounded-3xl bg-slate-900/40 p-8 shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] backdrop-blur-xl ring-1 ring-white/10 relative">
          <div className="space-y-5">
            
            {/* Input Email */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Tài khoản Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@aquaalert.vn"
                className="h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm font-medium text-white placeholder-slate-500 outline-none transition-all focus:border-cyan-500 focus:bg-black/40 focus:ring-1 focus:ring-cyan-500"
              />
            </div>

            {/* Input Password */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Mật khẩu
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm font-medium text-white placeholder-slate-500 outline-none transition-all focus:border-amber-500 focus:bg-black/40 focus:ring-1 focus:ring-amber-500"
              />
            </div>

            {/* Button Actions */}
            <div className="pt-2 flex flex-col gap-3">
              <button
                disabled={loading}
                onClick={async () => {
                  if (!email.trim()) {
                    toast.error('Vui lòng nhập email đăng nhập!')
                    return
                  }
                  if (!password) {
                    toast.error('Vui lòng nhập mật khẩu!')
                    return
                  }

                  setLoading(true)
                  try {
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
                className="group relative flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 to-amber-600 px-4 font-bold text-white shadow-lg transition-all hover:from-cyan-500 hover:to-amber-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Đang xác thực...
                  </>
                ) : (
                  <>
                    Đăng nhập hệ thống
                    <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                  </>
                )}
              </button>
              
              <button
                disabled={loading}
                onClick={() => {
                  localStorage.clear()
                  toast('Đã làm mới dữ liệu cục bộ')
                }}
                className="h-11 w-full rounded-xl bg-white/5 text-sm font-semibold text-slate-300 transition-colors hover:bg-white/10 hover:text-white focus:outline-none"
              >
                Xóa Cache / Làm mới
              </button>
            </div>
            
          </div>
        </div>

        {/* Footer Links */}
        <div className="mt-6 flex items-center justify-center gap-6 text-sm font-medium">
          <Link 
            className="text-slate-400 transition-colors hover:text-cyan-400 hover:underline" 
            to="/forgot-password"
          >
            Quên mật khẩu?
          </Link>
          <div className="h-4 w-px bg-white/20" />
          <Link 
            className="text-slate-400 transition-colors hover:text-amber-400 hover:underline" 
            to="/register"
          >
            Đăng ký
          </Link>
        </div>

      </div>
    </div>
  )
}
