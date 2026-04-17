import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { UserCircle2 } from 'lucide-react'
import { CardHeader, CardMeta, CardTitle } from '../components/Card'
import { Input } from '../components/Input'
import { Button } from '../components/Button'
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
    const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3002'
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
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-md dark:border-slate-800 dark:bg-slate-900">
          <CardHeader className="mb-4">
            <div>
              <CardTitle>{t('profile.personalInfo')}</CardTitle>
              <CardMeta>{t('profile.accountHint')}</CardMeta>
            </div>
          </CardHeader>

          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            {/* Input file ẩn, chỉ hiện Avatar clickable */}
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept="image/png,image/jpeg,image/jpg"
              onChange={(e) => setAvatarFile(e.target.files?.[0] ?? null)}
            />

            <div
              className="group relative grid h-28 w-28 shrink-0 cursor-pointer place-items-center rounded-2xl bg-gradient-to-br from-sky-100 to-indigo-100 shadow-inner ring-2 ring-white dark:from-sky-950/40 dark:to-indigo-950/40 dark:ring-slate-700 overflow-hidden"
              onClick={() => fileInputRef.current?.click()}
            >
              {displayAvatar ? (
                <img
                  src={displayAvatar}
                  alt="avatar"
                  className="h-full w-full object-cover transition-opacity duration-300 group-hover:opacity-75"
                />
              ) : (
                <UserCircle2 className="h-20 w-20 text-sky-700 opacity-90 transition-transform duration-300 group-hover:scale-110 dark:text-sky-300" strokeWidth={1.25} />
              )}
              {/* Overlay chỉ hiện khi hover */}
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                <span className="text-xs font-semibold text-white">Thay đổi</span>
              </div>
            </div>

            <div className="min-w-0 flex-1 space-y-3 text-center sm:text-left">
              <div>
                <div className="text-lg font-extrabold text-slate-900 dark:text-slate-100">{user.full_name}</div>
                <div className="text-sm text-slate-600 dark:text-slate-400">{user.email}</div>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{t('profile.role')}:</span>
                <RoleBadge role={user.role} />
              </div>
            </div>
          </div>

          <div className="mt-6 space-y-4 border-t border-slate-200 pt-6 dark:border-slate-800">
            <Input label={t('profile.name')} value={name} onChange={(e) => setName(e.target.value)} />

            {/* Trường Email bị khóa */}
            <div>
              <Input
                label={t('profile.email')}
                value={email}
                onChange={() => { }}
                disabled
                readOnly
                className="cursor-not-allowed bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Email không thể thay đổi
              </p>
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                className="min-w-[8rem]"
                disabled={saving || (name.trim() === user.full_name && !avatarFile)}
                onClick={handleSaveProfile}
              >
                {saving ? 'Đang lưu…' : t('profile.saveChanges')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setName(user.full_name)
                  setAvatarFile(null)
                  if (fileInputRef.current) fileInputRef.current.value = ''
                }}
              >
                {t('profile.reset')}
              </Button>
            </div>
          </div>
        </section>

        <div className="space-y-6">
          {/* BẢO MẬT & ĐỔI MẬT KHẨU */}
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-md dark:border-slate-800 dark:bg-slate-900">
            <CardHeader className="mb-4">
              <div>
                <CardTitle>Bảo mật</CardTitle>
                <CardMeta>Quản lý mật khẩu và tài khoản</CardMeta>
              </div>
            </CardHeader>

            <div className="space-y-4">
              <Input
                label="Mật khẩu hiện tại"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
              <Input
                label="Mật khẩu mới"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <Input
                label="Xác nhận mật khẩu mới"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />

              <div className="pt-2">
                <Button
                  onClick={handleChangePassword}
                  disabled={changingPwd || !currentPassword || !newPassword || !confirmPassword}
                >
                  {changingPwd ? 'Đang cập nhật...' : 'Đổi mật khẩu'}
                </Button>
              </div>
            </div>
          </section>

          {/* CHỈ SỐ THỐNG KÊ */}
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-md dark:border-slate-800 dark:bg-slate-900">
            <CardHeader className="mb-4">
              <div>
                <CardTitle>{t('profile.statsTitle')}</CardTitle>
                <CardMeta>{t('profile.accountHint')}</CardMeta>
              </div>
            </CardHeader>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/50">
                <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">{t('profile.reportsSent')}</div>
                <div className="mt-1 text-2xl font-extrabold text-sky-700 dark:text-sky-300">12</div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/50">
                <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">{t('profile.aiRuns')}</div>
                <div className="mt-1 text-2xl font-extrabold text-indigo-700 dark:text-indigo-300">45</div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
