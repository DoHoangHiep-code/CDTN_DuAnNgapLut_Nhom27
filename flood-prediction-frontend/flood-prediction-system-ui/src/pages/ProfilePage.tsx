import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { UserCircle2 } from 'lucide-react'
import { CardHeader, CardMeta, CardTitle } from '../components/common/Card'
import { Input } from '../components/common/Input'
import { Button } from '../components/common/Button'
import { useAuth } from '../context/AuthContext'
import { useTranslation } from 'react-i18next'
import { cn } from '../utils/cn'
import type { Role } from '../utils/types'
import { updateMyProfile, uploadMyAvatar, authChangePassword } from '../services/api'

function RoleBadge({ role }: { role: Role }) {
  const { t } = useTranslation()
  const cls =
    role === 'admin'
      ? 'bg-red-100 text-red-800 ring-red-200 dark:bg-red-950/50 dark:text-red-200 dark:ring-red-800'
      : role === 'expert'
        ? 'bg-orange-100 text-orange-800 ring-orange-200 dark:bg-orange-950/40 dark:text-orange-200 dark:ring-orange-800'
        : 'bg-slate-100 text-slate-800 ring-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-600'

  const label =
    role === 'admin' ? t('profile.roleAdmin') : role === 'expert' ? t('profile.roleExpert') : t('profile.roleUser')

  return <span className={cn('inline-flex items-center rounded-full px-3 py-1 text-xs font-extrabold ring-1', cls)}>{label}</span>
}

export function ProfilePage() {
  const { t } = useTranslation()
  const { user, fetchProfile } = useAuth()

  // State Profile
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // State Change Password
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPwd, setChangingPwd] = useState(false)

  // Xem trước Avatar
  const avatarPreview = useMemo(() => {
    if (!avatarFile) return null
    return URL.createObjectURL(avatarFile)
  }, [avatarFile])

  // Lấy đường dẫn base URL cho avatar
  // Nếu path tương đối (ví dụ: /uploads/abc.jpg) thì thêm url backend
  const displayAvatar = useMemo(() => {
    if (avatarPreview) return avatarPreview
    if (!user || !user.avatar_url) return null

    if (user.avatar_url.startsWith('http')) {
      return user.avatar_url
    }
    const apiUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3002/api/v1'
    const baseUrl = apiUrl.replace(/\/api\/v1\/?$/, '')
    return `${baseUrl.replace(/\/+$/, '')}${user.avatar_url}`
  }, [avatarPreview, user])

  useEffect(() => {
    setName(user?.full_name ?? '')
    setEmail(user?.email ?? '')
  }, [user])

  if (!user) return null

  // Đổi mật khẩu
  async function handleChangePassword() {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error('Vui lòng nhập đầy đủ các trường mật khẩu')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error('Mật khẩu mới và xác nhận mật khẩu không khớp')
      return
    }
    if (newPassword.length < 6) {
      toast.error('Mật khẩu mới phải có ít nhất 6 ký tự')
      return
    }

    setChangingPwd(true)
    try {
      await authChangePassword({ currentPassword, newPassword })
      toast.success('Đổi mật khẩu thành công')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (e: any) {
      const msg = e?.response?.data?.error?.message || e?.response?.data?.message || 'Đổi mật khẩu thất bại'
      toast.error(String(msg))
    } finally {
      setChangingPwd(false)
    }
  }

  // Cập nhật Profile
  async function handleSaveProfile() {
    setSaving(true)
    try {
      let updated = false
      if (name.trim() !== user?.full_name) {
        await updateMyProfile({ full_name: name.trim() })
        updated = true
      }
      if (avatarFile) {
        await uploadMyAvatar(avatarFile)
        setAvatarFile(null)
        updated = true
      }

      if (updated) {
        toast.success('Cập nhật hồ sơ thành công')
        await fetchProfile() // Sync global state
      } else {
        toast('Không có thông tin nào thay đổi', { icon: 'ℹ️' })
      }
    } catch (e: any) {
      const msg = e?.response?.data?.error?.message || 'Cập nhật thất bại'
      toast.error(String(msg))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">{t('profile.title')}</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('profile.hint')}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* THÔNG TIN CÁ NHÂN */}
        <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/50 dark:border-slate-800/80 dark:bg-slate-900/60 dark:shadow-none dark:backdrop-blur-xl">
          <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-sky-500/10 blur-3xl dark:bg-sky-500/5"></div>
          
          <CardHeader className="mb-6 relative z-10">
            <div>
              <CardTitle className="text-xl">Hồ sơ cá nhân</CardTitle>
              <CardMeta>Cập nhật ảnh đại diện và thông tin cơ bản</CardMeta>
            </div>
          </CardHeader>

          <div className="relative z-10 flex flex-col items-center gap-6 sm:flex-row sm:items-start">
            {/* Input file ẩn, chỉ hiện Avatar clickable */}
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept="image/png,image/jpeg,image/jpg"
              onChange={(e) => setAvatarFile(e.target.files?.[0] ?? null)}
            />

            <div
              className="group relative grid h-32 w-32 shrink-0 cursor-pointer place-items-center rounded-full bg-gradient-to-br from-indigo-100 via-sky-50 to-white shadow-inner ring-4 ring-white transition-all hover:shadow-lg dark:from-indigo-900/50 dark:via-slate-800 dark:to-slate-900 dark:ring-slate-800 overflow-hidden"
              onClick={() => fileInputRef.current?.click()}
            >
              {displayAvatar ? (
                <img
                  src={displayAvatar}
                  alt="avatar"
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                />
              ) : (
                <UserCircle2 className="h-20 w-20 text-indigo-400 opacity-90 transition-transform duration-500 group-hover:scale-110 dark:text-indigo-500" strokeWidth={1} />
              )}
              {/* Overlay chỉ hiện khi hover */}
              <div className="absolute inset-0 flex items-center justify-center bg-slate-900/40 opacity-0 backdrop-blur-sm transition-opacity duration-300 group-hover:opacity-100">
                <span className="text-xs font-bold uppercase tracking-wider text-white">Thay ảnh</span>
              </div>
            </div>

            <div className="min-w-0 flex-1 space-y-3 text-center sm:text-left pt-2">
              <div>
                <div className="text-2xl font-black tracking-tight text-slate-900 dark:text-slate-100">{user.full_name}</div>
                <div className="text-sm font-medium text-slate-500 dark:text-slate-400">{user.email}</div>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start pt-1">
                <RoleBadge role={user.role} />
              </div>
            </div>
          </div>

          <div className="relative z-10 mt-8 space-y-5 rounded-xl bg-slate-50/50 p-5 border border-slate-100 dark:bg-slate-800/30 dark:border-slate-800/50">
            <Input 
              label={t('profile.name')} 
              value={name} 
              onChange={(e) => setName(e.target.value)} 
            />

            {/* Trường Email bị khóa */}
            <div>
              <Input
                label={t('profile.email')}
                value={email}
                onChange={() => { }}
                disabled
                readOnly
                className="cursor-not-allowed opacity-70"
              />
              <p className="mt-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                <UserCircle2 className="h-3 w-3" /> Email cố định, không thể thay đổi
              </p>
            </div>

            <div className="flex flex-wrap gap-3 pt-4">
              <Button
                className="min-w-[10rem] shadow-md shadow-indigo-500/20"
                disabled={saving || (name.trim() === user.full_name && !avatarFile)}
                onClick={handleSaveProfile}
              >
                {saving ? 'Đang lưu…' : 'Lưu thay đổi'}
              </Button>
              <Button
                variant="ghost"
                className="hover:bg-slate-200/50 dark:hover:bg-slate-800"
                onClick={() => {
                  setName(user.full_name)
                  setAvatarFile(null)
                  if (fileInputRef.current) fileInputRef.current.value = ''
                }}
              >
                Hủy bỏ
              </Button>
            </div>
          </div>
        </section>

        <div className="space-y-6">
          {/* BẢO MẬT & ĐỔI MẬT KHẨU */}
          <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/50 dark:border-slate-800/80 dark:bg-slate-900/60 dark:shadow-none dark:backdrop-blur-xl">
            <div className="absolute -left-20 -top-20 h-64 w-64 rounded-full bg-rose-500/10 blur-3xl dark:bg-rose-500/5"></div>
            
            <CardHeader className="mb-6 relative z-10">
              <div>
                <CardTitle className="text-xl">Bảo mật</CardTitle>
                <CardMeta>Quản lý mật khẩu để bảo vệ tài khoản</CardMeta>
              </div>
            </CardHeader>

            <div className="relative z-10 space-y-5 rounded-xl bg-slate-50/50 p-5 border border-slate-100 dark:bg-slate-800/30 dark:border-slate-800/50">
              <Input
                label="Mật khẩu hiện tại"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••"
              />
              <Input
                label="Mật khẩu mới"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
              />
              <Input
                label="Xác nhận mật khẩu mới"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
              />

              <div className="pt-4">
                <Button
                  onClick={handleChangePassword}
                  disabled={changingPwd || !currentPassword || !newPassword || !confirmPassword}
                  className="w-full sm:w-auto min-w-[10rem] shadow-md shadow-indigo-500/20"
                >
                  {changingPwd ? 'Đang xử lý...' : 'Đổi mật khẩu'}
                </Button>
              </div>
            </div>
          </section>

          {/* CHỈ SỐ THỐNG KÊ */}
          <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/50 dark:border-slate-800/80 dark:bg-slate-900/60 dark:shadow-none dark:backdrop-blur-xl">
            <CardHeader className="mb-6 relative z-10">
              <div>
                <CardTitle className="text-xl">Thống kê hoạt động</CardTitle>
                <CardMeta>Hiệu suất sử dụng hệ thống của bạn</CardMeta>
              </div>
            </CardHeader>
            <div className="relative z-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="group rounded-2xl border border-slate-100 bg-gradient-to-br from-sky-50 to-white p-5 shadow-sm transition-all hover:-translate-y-1 hover:shadow-md dark:border-slate-800/80 dark:from-slate-800/50 dark:to-slate-800/10">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Báo cáo đã gửi</div>
                <div className="mt-2 text-4xl font-black text-sky-600 dark:text-sky-400">12</div>
              </div>
              <div className="group rounded-2xl border border-slate-100 bg-gradient-to-br from-indigo-50 to-white p-5 shadow-sm transition-all hover:-translate-y-1 hover:shadow-md dark:border-slate-800/80 dark:from-slate-800/50 dark:to-slate-800/10">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Lần chạy mô phỏng</div>
                <div className="mt-2 text-4xl font-black text-indigo-600 dark:text-indigo-400">45</div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
