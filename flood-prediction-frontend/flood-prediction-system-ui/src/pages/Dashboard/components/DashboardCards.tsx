import { Droplets, Thermometer, Wind } from 'lucide-react'
import { Card, CardHeader, CardMeta, CardTitle } from '../../../components/Card'
import { useTranslation } from 'react-i18next'
import type { DashboardResponse, DashboardTempHumPoint } from '../../../utils/types'

type DashboardCardsProps = {
  cw: DashboardResponse['currentWeather']
  tempHumData?: DashboardTempHumPoint[]
}

/**
 * Tìm record gần nhất với giờ hiện tại trong mảng tempHumData.
 * Nếu tìm thấy, dùng temp/rhum thực tế thay vì AVG 72h.
 */
function findCurrentHourData(tempHumData?: DashboardTempHumPoint[]) {
  if (!tempHumData || tempHumData.length === 0) return null
  // Lấy giờ hiện tại (format DD/MM HH:MM)
  const now = new Date()
  const dd = String(now.getDate()).padStart(2, '0')
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const currentLabel = `${dd}/${mm} ${hh}:00`
  // Tìm chính xác
  const exact = tempHumData.find(p => p.time === currentLabel)
  if (exact) return exact
  // Fallback: lấy record đầu tiên (gần nhất vì mảng sorted ASC)
  return tempHumData[0]
}

export function DashboardCards({ cw, tempHumData }: DashboardCardsProps) {
  const { t } = useTranslation()
  const currentData = findCurrentHourData(tempHumData)

  // Ưu tiên dữ liệu giờ hiện tại, fallback về cw (AVG gần nhất từ backend)
  const displayTemp = currentData?.temp ?? cw.temperature
  const displayHum  = currentData?.rhum ?? cw.humidity

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t('dashboard.temperature')}</CardTitle>
            <CardMeta>Dữ liệu thực · giờ hiện tại</CardMeta>
          </div>
          <Thermometer className="fps-3d-icon h-9 w-9 text-orange-500 drop-shadow-sm dark:text-orange-400" />
        </CardHeader>
        <div className="text-3xl font-extrabold text-orange-600 dark:text-orange-400">
          {displayTemp.toFixed(1)}°C
        </div>
        <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          {currentData ? 'Giờ hiện tại' : 'Trung bình các trạm'}
        </div>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t('dashboard.humidity')}</CardTitle>
            <CardMeta>Dữ liệu thực · giờ hiện tại</CardMeta>
          </div>
          <Droplets className="fps-3d-icon h-9 w-9 text-sky-600 drop-shadow-sm dark:text-sky-400" />
        </CardHeader>
        <div className="text-3xl font-extrabold text-sky-600 dark:text-sky-400">
          {displayHum.toFixed(0)}%
        </div>
        <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('dashboard.comfortHint')}</div>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t('dashboard.wind')}</CardTitle>
            <CardMeta>Dữ liệu thực · giờ hiện tại</CardMeta>
          </div>
          <Wind className="fps-3d-icon h-9 w-9 text-cyan-600 drop-shadow-sm dark:text-cyan-400" />
        </CardHeader>
        <div className="text-3xl font-extrabold text-cyan-700 dark:text-cyan-300">
          {cw.windSpeed.toFixed(1)} m/s
        </div>
        <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('dashboard.windHint')}</div>
      </Card>
    </div>
  )
}
