import { Droplets, Thermometer, Wind } from 'lucide-react'
import { Card } from '../../../../../components/common/Card'
import { useTranslation } from 'react-i18next'
import type { DashboardResponse, DashboardTempHumPoint } from '../../../../../utils/types'

type DashboardCardsProps = {
  cw: DashboardResponse['currentWeather']
  tempHumData?: DashboardTempHumPoint[]
}

export function DashboardCards({ cw, tempHumData }: DashboardCardsProps) {
  const { t } = useTranslation()

  const displayTemp = cw.temperature
  const displayHum  = cw.humidity

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <Card>
        <div className="flex items-center gap-4 p-4">
          <div className="rounded-xl bg-orange-100 p-3 dark:bg-orange-900/30">
            <Thermometer className="h-6 w-6 text-orange-600 dark:text-orange-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{t('dashboard.temperature')}</p>
            <h4 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              {displayTemp.toFixed(1)} <span className="text-sm font-normal text-slate-500">°C</span>
            </h4>
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex items-center gap-4 p-4">
          <div className="rounded-xl bg-sky-100 p-3 dark:bg-sky-900/30">
            <Droplets className="h-6 w-6 text-sky-600 dark:text-sky-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{t('dashboard.humidity')}</p>
            <h4 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              {displayHum.toFixed(0)} <span className="text-sm font-normal text-slate-500">%</span>
            </h4>
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex items-center gap-4 p-4">
          <div className="rounded-xl bg-cyan-100 p-3 dark:bg-cyan-900/30">
            <Wind className="h-6 w-6 text-cyan-600 dark:text-cyan-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{t('dashboard.wind')}</p>
            <h4 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              {cw.windSpeed.toFixed(1)} <span className="text-sm font-normal text-slate-500">m/s</span>
            </h4>
          </div>
        </div>
      </Card>
    </div>
  )
}
