import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { UserCircle2 } from 'lucide-react'
import { CardHeader, CardMeta, CardTitle } from '../components/Card'
import { Input } from '../components/Input'
import { Button } from '../components/Button'
import { Toggle } from '../components/Toggle'
import { useAuth } from '../context/AuthContext'
import { useTranslation } from 'react-i18next'
import { cn } from '../utils/cn'
import type { Role } from '../utils/types'
import { updateMyProfile, uploadMyAvatar } from '../services/api'

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
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [emailNotif, setEmailNotif] = useState(true)
  const [floodAlert, setFloodAlert] = useState(false)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)

  // Preview avatar trước khi upload để UX tốt hơn
  const avatarPreview = useMemo(() => {
    if (!avatarFile) return null
    return URL.createObjectURL(avatarFile)
  }, [avatarFile])

  useEffect(() => {
    setName(user?.full_name ?? '')
    setEmail(user?.email ?? '')
  }, [user])

  if (!user) return null

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">{t('profile.title')}</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('profile.hint')}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-md dark:border-slate-800 dark:bg-slate-900">
          <CardHeader className="mb-4">
            <div>
              <CardTitle>{t('profile.personalInfo')}</CardTitle>
              <CardMeta>{t('profile.accountHint')}</CardMeta>
            </div>
          </CardHeader>

          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <div className="grid h-28 w-28 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-sky-100 to-indigo-100 shadow-inner ring-2 ring-white dark:from-sky-950/40 dark:to-indigo-950/40 dark:ring-slate-700">
              {avatarPreview || user.avatar_url ? (
                <img
                  src={avatarPreview ?? user.avatar_url ?? ''}
                  alt="avatar"
                  className="h-24 w-24 rounded-2xl object-cover"
                />
              ) : (
                <UserCircle2 className="h-20 w-20 text-sky-700 opacity-90 dark:text-sky-300" strokeWidth={1.25} />
              )}
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
            {/* Hiển thị email/role dạng read-only để đúng yêu cầu bảo mật */}
            <Input label={t('profile.name')} value={name} onChange={(e) => setName(e.target.value)} />
            <Input label={t('profile.email')} value={email} onChange={() => {}} disabled />

            {/* Upload avatar: dùng FormData + multipart/form-data */}
            <div>
              <div className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-200">Avatar</div>
              <input
                type="file"
                accept="image/png,image/jpeg,image/jpg"
                onChange={(e) => setAvatarFile(e.target.files?.[0] ?? null)}
                className="block w-full text-xs text-slate-700 dark:text-slate-200"
              />
              <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">Chỉ chấp nhận PNG/JPG/JPEG, tối đa 2MB.</div>
              <Button
                className="mt-2"
                variant="secondary"
                disabled={!avatarFile || saving}
                onClick={async () => {
                  if (!avatarFile) return
                  setSaving(true)
                  try {
                    await uploadMyAvatar(avatarFile)
                    toast.success('Cập nhật avatar thành công')
                    setAvatarFile(null)
                    // Refresh profile để sidebar/ UI cập nhật avatar_url mới
                    await fetchProfile()
                  } catch (e: any) {
                    const msg = e?.response?.data?.error?.message || 'Upload avatar thất bại'
                    toast.error(String(msg))
                  } finally {
                    setSaving(false)
                  }
                }}
              >
                {saving ? 'Đang upload…' : 'Lưu avatar'}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                className="min-w-[8rem]"
                onClick={() => {
                  // Chỉ update full_name theo API backend, tránh sửa role/email
                  void (async () => {
                    setSaving(true)
                    try {
                      await updateMyProfile({ full_name: name.trim() })
                      toast.success('Cập nhật hồ sơ thành công')
                      await fetchProfile()
                    } catch (e: any) {
                      const msg = e?.response?.data?.error?.message || 'Cập nhật thất bại'
                      toast.error(String(msg))
                    } finally {
                      setSaving(false)
                    }
                  })()
                }}
              >
                {t('profile.saveChanges')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setName(user.full_name)
                  setEmail(user.email)
                }}
              >
                {t('profile.reset')}
              </Button>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-md dark:border-slate-800 dark:bg-slate-900">
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
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-md dark:border-slate-800 dark:bg-slate-900">
            <div className="space-y-5">
              <Toggle
                label={t('profile.toggleEmail')}
                hint={t('profile.toggleEmailHint')}
                checked={emailNotif}
                onChange={setEmailNotif}
              />
              <div className="border-t border-slate-100 dark:border-slate-800" />
              <Toggle
                label={t('profile.toggleFlood')}
                hint={t('profile.toggleFloodHint')}
                checked={floodAlert}
                onChange={setFloodAlert}
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
