import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Waves, ArrowLeft, KeyRound, Loader2, CheckSquare, Square } from 'lucide-react'
import { authResetPassword } from '../services/api'
import { cn } from '../utils/cn'

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const navigate = useNavigate()

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isCaptchaChecked, setIsCaptchaChecked] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    if (!token) {
      toast.error('Liên kết không hợp lệ hoặc đã hết hạn (Thiếu token)')
      return
    }
    if (!newPassword || newPassword.length < 6) {
      toast.error('Mật khẩu mới phải có ít nhất 6 ký tự')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error('Mật khẩu xác nhận không khớp!')
      return
    }
    if (!isCaptchaChecked) {
      toast.error('Vui lòng xác nhận bạn không phải người máy')
      return
    }

    setLoading(true)
    try {
      const res = await authResetPassword({ token, newPassword })
      if (res.success) {
        toast.success('Đặt lại mật khẩu thành công!')
        navigate('/login')
      }
    } catch (e: any) {
      const msg = e?.response?.data?.error?.message || e?.response?.data?.message || 'Có lỗi xảy ra, vui lòng thử lại'
      toast.error(String(msg))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-dvh overflow-hidden bg-slate-950 flex items-center justify-center p-4 selection:bg-cyan-500/30">
      {/* ── Background Animations & Gradients ── */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900" />
        <div className="absolute top-[10%] right-[10%] h-[60%] w-[50%] rounded-full bg-cyan-700/20 blur-[120px] mix-blend-screen" />
        <div className="absolute bottom-[10%] left-[10%] h-[50%] w-[50%] rounded-full bg-blue-600/10 blur-[100px] mix-blend-screen" />
        <div className="absolute inset-0 bg-[url('/noise.svg')] opacity-20 mix-blend-overlay" />
      </div>

      {/* ── Main Content ── */}
      <div className="relative z-10 w-full max-w-md">
        
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-white/5 shadow-2xl backdrop-blur-md ring-1 ring-white/20">
            <Waves className="h-10 w-10 text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white drop-shadow-sm">
            Tạo mật khẩu mới
          </h1>
          <p className="mt-2 text-sm font-medium text-slate-300">
            Vui lòng nhập mật khẩu mới cho tài khoản của bạn
          </p>
        </div>

        {/* Form Card */}
        <div className="overflow-hidden rounded-3xl bg-slate-900/40 p-8 shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] backdrop-blur-xl ring-1 ring-white/10 relative">
          <div className="space-y-5">
            
            {/* Input New Password */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Mật khẩu mới
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
                className="h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm font-medium text-white placeholder-slate-500 outline-none transition-all focus:border-cyan-500 focus:bg-black/40 focus:ring-1 focus:ring-cyan-500"
              />
            </div>

            {/* Input Confirm Password */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Nhập lại mật khẩu
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm font-medium text-white placeholder-slate-500 outline-none transition-all focus:border-cyan-500 focus:bg-black/40 focus:ring-1 focus:ring-cyan-500"
              />
            </div>

            {/* Mock CAPTCHA */}
            <div 
              onClick={() => setIsCaptchaChecked(!isCaptchaChecked)}
              className={cn(
                "mt-4 flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition-all",
                isCaptchaChecked 
                  ? "border-green-500/50 bg-green-500/10 text-green-400" 
                  : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
              )}
            >
              {isCaptchaChecked ? (
                <CheckSquare className="h-6 w-6 text-green-500" />
              ) : (
                <Square className="h-6 w-6 text-slate-400" />
              )}
              <span className="text-sm font-semibold select-none">Tôi không phải người máy</span>
            </div>

            {/* Button Actions */}
            <div className="pt-2">
              <button
                disabled={loading}
                onClick={handleSubmit}
                className="group relative flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 px-4 font-bold text-white shadow-lg transition-all hover:from-cyan-500 hover:to-blue-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Đang cập nhật...
                  </>
                ) : (
                  <>
                    Xác nhận
                    <KeyRound className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
            
          </div>
        </div>

        {/* Footer Links */}
        <div className="mt-6 text-center text-sm font-medium text-slate-400">
          <Link 
            className="flex items-center justify-center gap-1 text-slate-400 transition-colors hover:text-cyan-400 hover:underline" 
            to="/login"
          >
            <ArrowLeft className="h-4 w-4" />
            Hủy và quay lại đăng nhập
          </Link>
        </div>

      </div>
    </div>
  )
}
