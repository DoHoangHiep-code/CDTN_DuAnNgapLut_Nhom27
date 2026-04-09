import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Search, Trash2, Pencil } from 'lucide-react'

import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { Spinner } from '../components/Spinner'
import { ErrorState } from '../components/ErrorState'
import { Title3D } from '../components/Title3D'
import { GlassCard } from '../components/GlassCard'
import { useAsync } from '../hooks/useAsync'
import { adminCreateUser, adminDeleteUser, adminListUsers, adminUpdateUser } from '../services/api'
import { useAuth } from '../context/AuthContext'

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

function RolePill({ role }: { role: Role }) {
  const cls =
    role === 'admin'
      ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-200'
      : role === 'expert'
        ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-200'
        : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200'
  return <span className={`inline-flex rounded-full px-2 py-1 text-xs font-extrabold ${cls}`}>{role}</span>
}

function UserModal({
  state,
  onClose,
  onSaved,
}: {
  state: ModalState
  onClose: () => void
  onSaved: () => void
}) {
  const { user } = useAuth()

  if (!state.open) return null
  const isEdit = state.mode === 'edit'
  const initial = state.initial || {}

  // Lý do tách state form: tránh phụ thuộc trực tiếp vào object list (dễ bug khi edit xong không refresh)
  const [fullName, setFullName] = useState(String((initial as any).full_name ?? ''))
  const [username, setUsername] = useState(String((initial as any).username ?? ''))
  const [email, setEmail] = useState(String((initial as any).email ?? ''))
  const [role, setRole] = useState<Role>(((initial as any).role as Role) ?? 'user')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)

  const isSelf = isEdit && user && Number(user.user_id) === Number((initial as any).user_id)

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-xl dark:bg-slate-950">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-extrabold text-slate-900 dark:text-slate-100">
              {isEdit ? 'Cập nhật người dùng' : 'Thêm người dùng'}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {isEdit ? 'Chỉnh sửa thông tin, role, hoặc đặt lại mật khẩu.' : 'Tạo tài khoản mới với role phù hợp.'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-2 py-1 text-sm font-bold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3">
          <Input label="Họ và tên" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          <Input label="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <Input label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-200">Role</span>
            <select
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-sky-500 dark:focus:ring-sky-900/40"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              // Security: backend cũng chặn, nhưng UI nên disable để admin hiểu rõ constraint
              disabled={Boolean(isSelf)}
              title={isSelf ? 'Không thể tự thay đổi role của chính mình' : 'Chọn role'}
            >
              <option value="admin">admin</option>
              <option value="expert">expert</option>
              <option value="user">user</option>
            </select>
            {isSelf ? (
              <span className="mt-1 block text-xs text-amber-700 dark:text-amber-200">
                Vì lý do bảo mật, bạn không thể tự thay đổi role của chính mình.
              </span>
            ) : null}
          </label>

          <Input
            label={isEdit ? 'Mật khẩu mới (tuỳ chọn)' : 'Mật khẩu'}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint={isEdit ? 'Để trống nếu không đổi mật khẩu.' : undefined}
          />
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Hủy
          </Button>
          <Button
            onClick={async () => {
              // Validate nhẹ ở FE để UX tốt hơn (backend vẫn validate lại)
              if (!fullName.trim() || !username.trim() || !email.trim()) {
                toast.error('Vui lòng nhập đầy đủ Họ tên/Username/Email.')
                return
              }
              if (!isEdit && !password.trim()) {
                toast.error('Vui lòng nhập mật khẩu.')
                return
              }

              setSaving(true)
              try {
                if (isEdit) {
                  const userId = Number((initial as any).user_id)
                  await adminUpdateUser(userId, {
                    full_name: fullName.trim(),
                    username: username.trim(),
                    email: email.trim(),
                    role,
                    password: password.trim() || undefined,
                  })
                  toast.success('Cập nhật thành công')
                } else {
                  await adminCreateUser({
                    full_name: fullName.trim(),
                    username: username.trim(),
                    email: email.trim(),
                    role,
                    password: password.trim(),
                  })
                  toast.success('Tạo người dùng thành công')
                }

                onClose()
                onSaved()
              } catch (e: any) {
                // Lý do: backend có thể trả message cụ thể (unique email/username, self-role-change...)
                const msg = e?.response?.data?.error?.message || e?.message || 'Lỗi hệ thống'
                toast.error(String(msg))
              } finally {
                setSaving(false)
              }
            }}
            disabled={saving}
          >
            {saving ? 'Đang lưu…' : 'Lưu'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function UserManagementPage() {
  const { user } = useAuth()
  const [q, setQ] = useState('')
  const [role, setRole] = useState<'all' | Role>('all')
  const [modal, setModal] = useState<ModalState>({ open: false })

  // Lý do debounce: search realtime nhưng không spam API mỗi keystroke
  const [qDebounced, setQDebounced] = useState(q)
  useEffect(() => {
    const t = window.setTimeout(() => setQDebounced(q), 250)
    return () => window.clearTimeout(t)
  }, [q])

  const users = useAsync(() => adminListUsers({ q: qDebounced, role }), [qDebounced, role])

  const rows = useMemo<AdminUserRow[]>(() => (Array.isArray(users.data) ? (users.data as AdminUserRow[]) : []), [users.data])

  if (users.loading) return <Spinner label="Loading users…" />
  if (users.error) return <ErrorState error={users.error} onRetry={users.reload} />

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Title3D>Quản lý người dùng</Title3D>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Tìm kiếm theo tên/email, lọc theo role và tạo/cập nhật/xóa tài khoản.
          </p>
        </div>
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setModal({ open: true, mode: 'create' })}>
          Thêm user
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <GlassCard className="lg:col-span-4 space-y-3">
          <div className="text-sm font-extrabold text-slate-900 dark:text-slate-100">Bộ lọc</div>

          <Input
            label="Tìm kiếm"
            placeholder="Nhập tên hoặc email…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-200">Role</span>
            <select
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-sky-500 dark:focus:ring-sky-900/40"
              value={role}
              onChange={(e) => setRole(e.target.value as any)}
            >
              <option value="all">All</option>
              <option value="admin">Admin</option>
              <option value="expert">Expert</option>
              <option value="user">User</option>
            </select>
          </label>

          <div className="flex gap-2">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => {
                setQ('')
                setRole('all')
              }}
            >
              Xóa lọc
            </Button>
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => {
                void users.reload()
                toast.success('Đã làm mới')
              }}
            >
              Làm mới
            </Button>
          </div>
        </GlassCard>

        <GlassCard className="lg:col-span-8 p-0 overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
            <div className="flex items-center gap-2 text-sm font-extrabold text-slate-900 dark:text-slate-100">
              <Search className="h-4 w-4 text-slate-500 dark:text-slate-300" />
              Danh sách ({rows.length})
            </div>
          </div>

          <div className="overflow-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="sticky top-0 bg-white text-xs font-extrabold text-slate-700 dark:bg-slate-900 dark:text-slate-200">
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className="px-4 py-3">Avatar</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {rows.map((r) => {
                  const isSelf = user && Number(user.user_id) === Number(r.user_id)
                  return (
                    <tr key={r.user_id} className="hover:bg-slate-50 dark:hover:bg-slate-950/30">
                      <td className="px-4 py-3">
                        {r.avatar_url ? (
                          <img
                            src={r.avatar_url}
                            alt="avatar"
                            className="h-9 w-9 rounded-xl object-cover ring-1 ring-slate-200 dark:ring-slate-800"
                          />
                        ) : (
                          <div className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-xs font-extrabold text-slate-600 dark:bg-slate-800 dark:text-slate-100">
                            {r.full_name?.trim()?.slice(0, 1)?.toUpperCase() || 'U'}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-extrabold text-slate-900 dark:text-slate-100">{r.full_name}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">@{r.username}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{r.email}</td>
                      <td className="px-4 py-3">
                        <RolePill role={r.role} />
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                        {new Date(r.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            leftIcon={<Pencil className="h-4 w-4" />}
                            onClick={() => setModal({ open: true, mode: 'edit', initial: r })}
                          >
                            Sửa
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            leftIcon={<Trash2 className="h-4 w-4" />}
                            disabled={Boolean(isSelf)}
                            title={isSelf ? 'Không thể tự xóa tài khoản của chính mình' : 'Xóa user'}
                            onClick={async () => {
                              // Xác nhận để tránh xóa nhầm (UX + an toàn thao tác admin)
                              const ok = window.confirm(`Xóa user "${r.full_name}"?`)
                              if (!ok) return
                              try {
                                await adminDeleteUser(r.user_id)
                                toast.success('Xóa thành công')
                                void users.reload()
                              } catch (e: any) {
                                const msg = e?.response?.data?.error?.message || e?.message || 'Lỗi hệ thống'
                                toast.error(String(msg))
                              }
                            }}
                          >
                            Xóa
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}

                {rows.length === 0 ? (
                  <tr>
                    <td className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400" colSpan={6}>
                      Không có dữ liệu.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </GlassCard>
      </div>

      <UserModal
        state={modal}
        onClose={() => setModal({ open: false })}
        onSaved={() => void users.reload()}
      />
    </div>
  )
}

