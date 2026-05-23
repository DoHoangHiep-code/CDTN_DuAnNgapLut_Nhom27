import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { MountainSnow, ArrowRight, Loader2 } from 'lucide-react'
import { authRegister } from '../services/api'

export function RegisterPage() {
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  return (
    <div className="relative min-h-dvh overflow-hidden bg-slate-950 flex items-center justify-center p-4 selection:bg-amber-500/30">
      {/* ── Background Animations & Gradients ── */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900" />
        
        {/* Vệt sáng cam/nâu (Sạt lở - Đất đá) */}
        <div className="absolute top-[-10%] left-[-10%] h-[60%] w-[50%] rounded-full bg-amber-700/20 blur-[120px] mix-blend-screen" />
        <div className="absolute bottom-[-10%] right-[10%] h-[50%] w-[50%] rounded-full bg-orange-600/10 blur-[100px] mix-blend-screen" />
        
        {/* Overlay lưới mờ tạo cảm giác công nghệ */}
        <div className="absolute inset-0 bg-[url('/noise.svg')] opacity-20 mix-blend-overlay" />
      </div>

      {/* ── Main Content ── */}
      <div className="relative z-10 w-full max-w-md">
        
        {/* Header (Logo + Title) */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-white/5 shadow-2xl backdrop-blur-md ring-1 ring-white/20">
            <MountainSnow className="h-10 w-10 text-amber-500 drop-shadow-[0_0_8px_rgba(245,158,11,0.8)]" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white drop-shadow-sm">
            Tạo tài khoản mới
          </h1>
          <p className="mt-2 text-sm font-medium text-slate-300">
            Đăng ký tham gia hệ thống giám sát cảnh báo
          </p>
        </div>

        {/* Form Card (Glassmorphism) */}
        <div className="overflow-hidden rounded-3xl bg-slate-900/40 p-8 shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] backdrop-blur-xl ring-1 ring-white/10 relative">
          <div className="space-y-5">
            
            {/* Input Name */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Họ và tên
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Nguyễn Văn A"
                className="h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm font-medium text-white placeholder-slate-500 outline-none transition-all focus:border-amber-500 focus:bg-black/40 focus:ring-1 focus:ring-amber-500"
              />
            </div>

            {/* Input Email */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@aquaalert.vn"
                className="h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm font-medium text-white placeholder-slate-500 outline-none transition-all focus:border-amber-500 focus:bg-black/40 focus:ring-1 focus:ring-amber-500"
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
            <div className="pt-2">
              <button
                disabled={loading}
                onClick={async () => {
                  if (!fullName.trim() || !email.trim() || !password) {
                    toast.error('Vui lòng nhập đầy đủ thông tin.')
                    return
                  }

                  setLoading(true)
                  try {
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
                className="group relative flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 px-4 font-bold text-white shadow-lg transition-all hover:from-amber-500 hover:to-orange-500 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Đang đăng ký...
                  </>
                ) : (
                  <>
                    Tạo tài khoản
                    <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                  </>
                )}
              </button>
            </div>
            
          </div>
        </div>

        {/* Footer Links */}
        <div className="mt-6 text-center text-sm font-medium text-slate-400">
          Đã có tài khoản?{' '}
          <Link 
            className="text-amber-400 transition-colors hover:text-amber-300 hover:underline" 
            to="/login"
          >
            Đăng nhập
          </Link>
        </div>

      </div>
    </div>
  )
}
