import { useState } from 'react'
import toast from 'react-hot-toast'
import { Moon, Sun, Bell, BellOff } from 'lucide-react'

import { CardHeader, CardMeta, CardTitle } from '../components/Card'
import { Toggle } from '../components/Toggle'
import { useSettings } from '../context/SettingsContext'
import { useTranslation } from 'react-i18next'
import { GlassCard } from '../components/GlassCard'
import { Title3D } from '../components/Title3D'
import { updateUserSettings } from '../services/api'

export function SettingsPage() {
  const { t } = useTranslation()

  // Lấy theme, toggleTheme và trạng thái cảnh báo từ SettingsContext.
  // Đã loại bỏ apiBaseUrl – không còn để người dùng tự nhập URL backend.
  const { theme, toggleTheme, floodAlertsEnabled, setFloodAlertsEnabled } = useSettings()

  // State loading riêng cho nút cảnh báo ngập để tránh double-click trong khi đang gọi API
  const [alertsLoading, setAlertsLoading] = useState(false)

  // ---------- Handler: Bật/tắt cảnh báo ngập lụt ----------
  // Hàm async: cập nhật UI ngay lập tức (optimistic update), sau đó gọi backend.
  // Nếu backend lỗi, rollback lại giá trị cũ và hiện toast lỗi.
  async function handleAlertToggle(newValue: boolean) {
    // Ngăn gọi API đồng thời nếu đang xử lý
    if (alertsLoading) return

    // Optimistic update: cập nhật UI ngay để người dùng thấy phản hồi tức thì
    const previousValue = floodAlertsEnabled
    setFloodAlertsEnabled(newValue)
    setAlertsLoading(true)

    try {
      // Gọi PUT /api/v1/users/settings để đồng bộ với backend
      await updateUserSettings({ floodAlertsEnabled: newValue })

      // Hiện toast thành công
      toast.success(
        newValue
          ? 'Đã bật cảnh báo ngập lụt ✅'
          : 'Đã tắt cảnh báo ngập lụt 🔕',
        { duration: 3000 },
      )
    } catch (err: any) {
      // Rollback về giá trị cũ nếu API thất bại
      setFloodAlertsEnabled(previousValue)

      // Hiện toast lỗi kèm thông điệp từ server nếu có
      const msg = err?.response?.data?.message ?? 'Không thể cập nhật cài đặt. Vui lòng thử lại.'
      toast.error(msg, { duration: 4000 })
    } finally {
      setAlertsLoading(false)
    }
  }

  // ---------- Render ----------
  return (
    <div className="space-y-6">
      {/* Tiêu đề trang */}
      <div>
        <Title3D>{t('settings.title')}</Title3D>
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('settings.hint')}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

        {/* ===== Card 1: Giao diện / Chế độ tối ===== */}
        <GlassCard className="space-y-4">
          <CardHeader>
            <div className="flex items-center gap-2">
              {/* Icon thay đổi theo theme hiện tại */}
              {theme === 'dark' ? (
                <Moon className="h-5 w-5 text-sky-400" />
              ) : (
                <Sun className="h-5 w-5 text-amber-500" />
              )}
              <div>
                <CardTitle>{t('settings.appearance')}</CardTitle>
                <CardMeta>{t('settings.darkModeHint')}</CardMeta>
              </div>
            </div>
          </CardHeader>

          {/*
            Toggle chế độ tối:
            - checked: true khi theme === 'dark'
            - onChange: gọi toggleTheme() từ context.
              toggleTheme() sẽ:
              1. Lật theme trong state
              2. applyTheme() thêm/xóa class 'dark' trên <html>
              3. Lưu vào localStorage để giữ lựa chọn sau khi tải lại trang
          */}
          <Toggle
            label={t('settings.darkMode')}
            checked={theme === 'dark'}
            onChange={toggleTheme}
            hint={t('settings.darkModeHint')}
          />
        </GlassCard>

        {/* ===== Card 2: Thông báo / Cảnh báo ngập ===== */}
        {/*
          Chiếm toàn bộ chiều ngang trên màn hình lớn (lg:col-span-2) khi chỉ còn 1 card nội dung.
          Nếu sau này thêm card thứ 3, bỏ lg:col-span-2 đi.
        */}
        <GlassCard className="space-y-4 lg:col-span-1">
          <CardHeader>
            <div className="flex items-center gap-2">
              {/* Icon thay đổi theo trạng thái cảnh báo */}
              {floodAlertsEnabled ? (
                <Bell className="h-5 w-5 text-sky-500" />
              ) : (
                <BellOff className="h-5 w-5 text-slate-400" />
              )}
              <div>
                <CardTitle>{t('settings.notifications')}</CardTitle>
                <CardMeta>{t('settings.floodAlertsHint')}</CardMeta>
              </div>
            </div>
          </CardHeader>

          {/*
            Toggle cảnh báo ngập lụt:
            - checked: trạng thái hiện tại từ context (đã lưu localStorage)
            - onChange: gọi handleAlertToggle (async) – optimistic update + gọi API thật
            - Khi alertsLoading = true, nút bị disable để tránh spam
          */}
          <div className={alertsLoading ? 'pointer-events-none opacity-60' : ''}>
            <Toggle
              label={t('settings.floodAlerts')}
              checked={floodAlertsEnabled}
              onChange={handleAlertToggle}
              hint={
                alertsLoading
                  ? 'Đang cập nhật...'
                  : t('settings.floodAlertsHint')
              }
            />
          </div>
        </GlassCard>

      </div>
    </div>
  )
}
