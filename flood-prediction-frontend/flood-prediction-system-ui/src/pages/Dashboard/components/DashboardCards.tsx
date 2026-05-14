import { Droplets, Thermometer, Wind } from 'lucide-react'
import { Card, CardHeader, CardMeta, CardTitle } from '../../../components/Card'
import { useTranslation } from 'react-i18next'
import type { DashboardResponse } from '../../../utils/types'

type DashboardCardsProps = {
  cw: DashboardResponse['currentWeather']
}

export function DashboardCards({ cw }: DashboardCardsProps) {
  const { t } = useTranslation()

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t('dashboard.temperature')}</CardTitle>
            <CardMeta>CockroachDB · giờ hiện tại</CardMeta>
          </div>
          <Thermometer className="fps-3d-icon h-9 w-9 text-orange-500 drop-shadow-sm dark:text-orange-400" />
        </CardHeader>
        <div className="text-3xl font-extrabold text-orange-600 dark:text-orange-400">
          {cw.temperature.toFixed(1)}°C
        </div>
        <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Trung bình các trạm đang chọn
        </div>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t('dashboard.humidity')}</CardTitle>
            <CardMeta>CockroachDB · giờ hiện tại</CardMeta>
          </div>
          <Droplets className="fps-3d-icon h-9 w-9 text-sky-600 drop-shadow-sm dark:text-sky-400" />
        </CardHeader>
        <div className="text-3xl font-extrabold text-sky-600 dark:text-sky-400">
          {cw.humidity.toFixed(0)}%
        </div>
        <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('dashboard.comfortHint')}</div>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t('dashboard.wind')}</CardTitle>
            <CardMeta>CockroachDB · giờ hiện tại</CardMeta>
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
