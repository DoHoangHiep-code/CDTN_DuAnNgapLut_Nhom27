import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
  Plus, Search, Trash2, Pencil, Users,
  ShieldCheck, Star, User as UserIcon,
  X, RefreshCcw, Filter, Mail, Calendar,
} from 'lucide-react'

import { Input } from '../components/Input'
import { Spinner } from '../components/Spinner'
import { ErrorState } from '../components/ErrorState'
import { useAsync } from '../hooks/useAsync'
import { adminCreateUser, adminDeleteUser, adminListUsers, adminUpdateUser } from '../services/api'
import { useAuth } from '../context/AuthContext'
import { cn } from '../utils/cn'

type Role = 'admin' | 'expert' | 'user'

type AdminUserRow = {
  user_id: number
  username: string
  email: string
  full_name: string
  avatar_url?: string | null
  role: Role
  created_at: string
}

type ModalState =
  | { open: false }
  | { open: true; mode: 'create'; initial?: Partial<AdminUserRow> }
  | { open: true; mode: 'edit'; initial: AdminUserRow }

const ROLE_CONFIG: Record<Role, { label: string; bg: string; text: string; border: string; dot: string; icon: typeof ShieldCheck }> = {
  admin:  { label: 'Admin',  bg: 'bg-rose-50 dark:bg-rose-950/30',    text: 'text-rose-700 dark:text-rose-400',    border: 'border-rose-200 dark:border-rose-800',    dot: 'bg-rose-500',    icon: ShieldCheck },
  expert: { label: 'Expert', bg: 'bg-amber-50 dark:bg-amber-950/30',  text: 'text-amber-700 dark:text-amber-400',  border: 'border-amber-200 dark:border-amber-800',  dot: 'bg-amber-400',   icon: Star },
  user:   { label: 'User',   bg: 'bg-sky-50 dark:bg-sky-950/30',      text: 'text-sky-700 dark:text-sky-400',      border: 'border-sky-200 dark:border-sky-800',      dot: 'bg-sky-500',     icon: UserIcon },
}

const AVATAR_COLORS = [
  'from-sky-500 to-blue-600',
  'from-violet-500 to-purple-600',
  'from-rose-500 to-pink-600',
  'from-amber-500 to-orange-600',
  'from-emerald-500 to-teal-600',
  'from-indigo-500 to-blue-600',
]

function RolePill({ role }: { role: Role }) {
  const cfg = ROLE_CONFIG[role] ?? ROLE_CONFIG.user
  const Icon = cfg.icon
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold', cfg.bg, cfg.text, cfg.border)}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  )
}

function UserAvatar({ name, avatarUrl, size = 'md' }: { name: string; avatarUrl?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const initials = name.split(' ').map((w) => w[0]).slice(-2).join('').toUpperCase() || 'U'
  const grad = AVATAR_COLORS[name.length % AVATAR_COLORS.length]
  const sizeClass = size === 'sm' ? 'h-8 w-8 text-[10px]' : size === 'lg' ? 'h-14 w-14 text-lg' : 'h-10 w-10 text-xs'

  if (avatarUrl) {
    return <img src={avatarUrl} alt={name} className={cn('flex-shrink-0 rounded-xl object-cover ring-2 ring-white dark:ring-slate-800', sizeClass)} />
  }
  return (
    <div className={cn('flex-shrink-0 grid place-items-center rounded-xl bg-gradient-to-br font-extrabold text-white shadow-sm', sizeClass, grad)}>
      {initials}
    </div>
  )
}

function UserModal({ state, onClose, onSaved }: { state: ModalState; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth()
  if (!state.open) return null
  const isEdit = state.mode === 'edit'
  const initial = state.initial || {}

  const [fullName, setFullName] = useState(String((initial as any).full_name ?? ''))
  const [username, setUsername] = useState(String((initial as any).username ?? ''))
  const [email, setEmail]       = useState(String((initial as any).email ?? ''))
  const [role, setRole]         = useState<Role>(((initial as any).role as Role) ?? 'user')
  const [password, setPassword] = useState('')
  const [saving, setSaving]     = useState(false)

  const isSelf = isEdit && user && Number(user.user_id) === Number((initial as any).user_id)

  async function handleSave() {
    if (!fullName.trim() || !username.trim() || !email.trim()) {
      toast.error('Vui lòng nhập đầy đủ Họ tên / Username / Email.')
      return
    }
    if (!isEdit && !password.trim()) { toast.error('Vui lòng nhập mật khẩu.'); return }
    setSaving(true)
    try {
      if (isEdit) {
        await adminUpdateUser(Number((initial as any).user_id), {
          full_name: fullName.trim(), username: username.trim(),
          email: email.trim(), role, password: password.trim() || undefined,
        })
        toast.success('Cập nhật thành công')
      } else {
        await adminCreateUser({ full_name: fullName.trim(), username: username.trim(), email: email.trim(), role, password: password.trim() })
        toast.success('Tạo người dùng thành công')
      }
      onClose(); onSaved()
    } catch (e: any) {
      toast.error(e?.response?.data?.error?.message || e?.message || 'Lỗi hệ thống')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
        {/* Modal header */}
        <div className="flex items-center gap-4 border-b border-slate-100 px-6 py-5 dark:border-slate-800">
          <div className={cn('grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br text-white', isEdit ? 'from-indigo-500 to-violet-600' : 'from-emerald-500 to-teal-600')}>
            {isEdit ? <Pencil className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
          </div>
          <div className="flex-1">
            <div className="font-extrabold text-slate-900 dark:text-slate-100">
              {isEdit ? 'Cập nhật người dùng' : 'Thêm người dùng mới'}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {isEdit ? 'Chỉnh sửa thông tin, role, hoặc đặt lại mật khẩu.' : 'Tạo tài khoản mới với role phù hợp.'}
            </div>
          </div>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <div className="space-y-4 px-6 py-5">
          {isEdit && (
            <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
              <UserAvatar name={(initial as any).full_name ?? ''} avatarUrl={(initial as any).avatar_url} size="lg" />
              <div>
                <div className="font-extrabold text-slate-800 dark:text-slate-100">{(initial as any).full_name}</div>
                <div className="text-xs text-slate-500">@{(initial as any).username}</div>
                <RolePill role={(initial as any).role} />
              </div>
            </div>
          )}
          <Input label="Họ và tên" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          <Input label="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <div>
            <span className="mb-1.5 block text-xs font-bold text-slate-700 dark:text-slate-300">Role</span>
            <div className="grid grid-cols-3 gap-2">
              {(['admin', 'expert', 'user'] as Role[]).map((r) => {
                const cfg = ROLE_CONFIG[r]
                const Icon = cfg.icon
                const active = role === r
                return (
                  <button
                    key={r}
                    type="button"
                    disabled={Boolean(isSelf)}
                    onClick={() => setRole(r)}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-xl border py-3 text-xs font-bold transition-all',
                      active ? cn(cfg.bg, cfg.text, cfg.border, 'ring-2 ring-offset-1', cfg.border) : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {cfg.label}
                  </button>
                )
              })}
            </div>
            {isSelf && <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">Không thể tự thay đổi role của chính mình.</p>}
          </div>
          <Input
            label={isEdit ? 'Mật khẩu mới (tuỳ chọn)' : 'Mật khẩu'}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint={isEdit ? 'Để trống nếu không đổi mật khẩu.' : undefined}
          />
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4 dark:border-slate-800">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            Hủy
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className={cn(
              'rounded-xl px-5 py-2 text-sm font-bold text-white shadow-sm transition',
              isEdit ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-emerald-600 hover:bg-emerald-700',
              'disabled:opacity-50',
            )}
          >
            {saving ? 'Đang lưu…' : isEdit ? 'Cập nhật' : 'Tạo tài khoản'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function UserManagementPage() {
  const { user } = useAuth()
  const [q, setQ]       = useState('')
  const [role, setRole] = useState<'all' | Role>('all')
  const [modal, setModal] = useState<ModalState>({ open: false })

  const [qDebounced, setQDebounced] = useState(q)
  useEffect(() => {
    const t = window.setTimeout(() => setQDebounced(q), 250)
    return () => window.clearTimeout(t)
  }, [q])

  const users = useAsync(() => adminListUsers({ q: qDebounced, role }), [qDebounced, role])
  const rows  = useMemo<AdminUserRow[]>(() => (Array.isArray(users.data) ? (users.data as AdminUserRow[]) : []), [users.data])

  const hasFilter = Boolean(q || role !== 'all')

  const roleCounts = useMemo(() => {
    const c = { admin: 0, expert: 0, user: 0 }
    rows.forEach((r) => { c[r.role] = (c[r.role] ?? 0) + 1 })
    return c
  }, [rows])

  if (users.loading) return <Spinner label="Loading users…" />
  if (users.error) return <ErrorState error={users.error} onRetry={users.reload} />

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 shadow-lg shadow-violet-200 dark:shadow-violet-900/40">
            <Users className="h-6 w-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">Quản lý người dùng</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Tìm kiếm, lọc theo role và quản lý tài khoản.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setModal({ open: true, mode: 'create' })}
          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-violet-200 transition hover:from-violet-700 hover:to-indigo-700 active:scale-95 dark:shadow-violet-900/40"
        >
          <Plus className="h-4 w-4" /> Thêm người dùng
        </button>
      </div>

      {/* ── Stats row ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Tổng tài khoản', value: rows.length, icon: Users, grad: 'from-violet-500 to-indigo-600', shadow: 'shadow-violet-100 dark:shadow-violet-900/20' },
          { label: 'Admin',  value: roleCounts.admin,  icon: ShieldCheck, grad: 'from-rose-500 to-pink-600',    shadow: 'shadow-rose-100 dark:shadow-rose-900/20' },
          { label: 'Expert', value: roleCounts.expert, icon: Star,        grad: 'from-amber-500 to-orange-600', shadow: 'shadow-amber-100 dark:shadow-amber-900/20' },
          { label: 'User',   value: roleCounts.user,   icon: UserIcon,    grad: 'from-sky-500 to-blue-600',     shadow: 'shadow-sky-100 dark:shadow-sky-900/20' },
        ].map((s) => (
          <div key={s.label} className={cn('flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900', s.shadow)}>
            <div className={cn('grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-sm', s.grad)}>
              <s.icon className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs text-slate-400 dark:text-slate-500">{s.label}</div>
              <div className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">{s.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Main layout ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">

        {/* Filter panel */}
        <div className="lg:col-span-3 space-y-4">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3.5 dark:border-slate-800">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-violet-100 dark:bg-violet-900/40">
                <Filter className="h-4 w-4 text-violet-500" />
              </div>
              <div className="flex-1 text-sm font-extrabold text-slate-800 dark:text-slate-100">Bộ lọc</div>
              {hasFilter && (
                <button
                  type="button"
                  onClick={() => { setQ(''); setRole('all') }}
                  className="flex items-center gap-1 rounded-lg bg-red-50 px-2 py-1 text-[11px] font-bold text-red-500 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400"
                >
                  <X className="h-3 w-3" /> Xóa
                </button>
              )}
            </div>
            <div className="space-y-4 p-4">
              {/* Search */}
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-400">
                  <Search className="h-3.5 w-3.5" /> Tìm kiếm
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Tên hoặc email..."
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-800 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              {/* Role filter pills */}
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-600 dark:text-slate-400">Role</label>
                <div className="space-y-1.5">
                  {(['all', 'admin', 'expert', 'user'] as const).map((r) => {
                    const active = role === r
                    const cfg = r !== 'all' ? ROLE_CONFIG[r] : null
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setRole(r)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-all',
                          active
                            ? (cfg ? cn(cfg.bg, cfg.text, 'border', cfg.border) : 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-100')
                            : 'text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800',
                        )}
                      >
                        {cfg ? <span className={cn('h-2 w-2 rounded-full', cfg.dot)} /> : <span className="h-2 w-2 rounded-full bg-slate-400" />}
                        {r === 'all' ? 'Tất cả' : cfg!.label}
                        <span className="ml-auto tabular-nums text-[10px]">
                          {r === 'all' ? rows.length : roleCounts[r as Role]}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <button
                type="button"
                onClick={() => { void users.reload(); toast.success('Đã làm mới') }}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <RefreshCcw className="h-3.5 w-3.5" /> Làm mới
              </button>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="lg:col-span-9 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
            <div>
              <div className="text-sm font-extrabold text-slate-900 dark:text-slate-100">
                Danh sách người dùng
              </div>
              <div className="text-xs text-slate-400 dark:text-slate-500">
                {rows.length} tài khoản
                {hasFilter && <span className="ml-1 rounded-full bg-violet-100 px-1.5 py-0.5 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400">đang lọc</span>}
              </div>
            </div>
          </div>

          <div className="overflow-auto">
            <table className="w-full min-w-[700px] text-left">
              <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800/80">
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">#</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    <span className="flex items-center gap-1.5"><UserIcon className="h-3.5 w-3.5" /> Người dùng</span>
                  </th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    <span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> Email</span>
                  </th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">Role</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    <span className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" /> Ngày tạo</span>
                  </th>
                  <th className="px-5 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-400">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map((r, idx) => {
                  const isSelf = user && Number(user.user_id) === Number(r.user_id)
                  return (
                    <tr key={r.user_id} className="group transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/30">
                      {/* # */}
                      <td className="px-5 py-4">
                        <span className="text-xs font-bold tabular-nums text-slate-300 dark:text-slate-600">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                      </td>
                      {/* User */}
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <UserAvatar name={r.full_name} avatarUrl={r.avatar_url} size="sm" />
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-extrabold text-slate-900 dark:text-slate-100">{r.full_name}</span>
                              {isSelf && (
                                <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold text-violet-600 dark:bg-violet-900/40 dark:text-violet-400">Bạn</span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400">@{r.username}</div>
                          </div>
                        </div>
                      </td>
                      {/* Email */}
                      <td className="px-4 py-4">
                        <span className="text-sm text-slate-600 dark:text-slate-300">{r.email}</span>
                      </td>
                      {/* Role */}
                      <td className="px-4 py-4">
                        <RolePill role={r.role} />
                      </td>
                      {/* Created */}
                      <td className="px-4 py-4">
                        <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                          {new Date(r.created_at).toLocaleDateString('vi-VN')}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {new Date(r.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </td>
                      {/* Actions */}
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setModal({ open: true, mode: 'edit', initial: r })}
                            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 shadow-sm hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                          >
                            <Pencil className="h-3.5 w-3.5" /> Sửa
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(isSelf)}
                            title={isSelf ? 'Không thể tự xóa tài khoản của mình' : 'Xóa người dùng'}
                            onClick={async () => {
                              if (!window.confirm(`Xóa user "${r.full_name}"?`)) return
                              try {
                                await adminDeleteUser(r.user_id)
                                toast.success('Xóa thành công')
                                void users.reload()
                              } catch (e: any) {
                                toast.error(e?.response?.data?.error?.message || e?.message || 'Lỗi hệ thống')
                              }
                            }}
                            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 shadow-sm hover:border-red-300 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Xóa
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-16 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Users className="h-10 w-10 text-slate-200 dark:text-slate-700" />
                        <div className="text-sm font-semibold text-slate-400">Không có người dùng nào</div>
                        {hasFilter && <div className="text-xs text-slate-400">Thử bỏ bộ lọc để xem toàn bộ</div>}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <UserModal
        state={modal}
        onClose={() => setModal({ open: false })}
        onSaved={() => void users.reload()}
      />
    </div>
  )
}
