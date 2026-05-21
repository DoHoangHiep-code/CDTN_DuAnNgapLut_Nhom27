import { CloudRain } from 'lucide-react'
import { Card, CardHeader, CardMeta, CardTitle } from '../../../../../components/common/Card'
import { RiskBadge } from '../../../../../components/common/Badge'
import { RainForecastChart } from './RainForecastChart'
import { TempHumidityChart } from './TempHumidityChart'
import { RiskTrendChart } from './RiskTrendChart'
import { useTranslation } from 'react-i18next'

type DashboardChartsProps = {
  forecast24h: any[]
  tempHum: any[]
  riskTrend: any[]
  riskSummary: any
  riskLabel: string
  hours: number
}

export function DashboardCharts({
  forecast24h,
  tempHum,
  riskTrend,
  riskSummary,
  riskLabel,
  hours
}: DashboardChartsProps) {
  const { t } = useTranslation()

  return (
    <>
      {/* ── Hàng 2: Mưa + Ngập | Nguy cơ ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>{t('dashboard.rainForecast')}</CardTitle>
              <CardMeta>Lượng mưa & độ ngập · {riskLabel} (CockroachDB)</CardMeta>
            </div>
          </CardHeader>
          <div className="h-56 min-h-[14rem]">
            <RainForecastChart points={forecast24h} />
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t('dashboard.floodRiskSummary')}</CardTitle>
              <CardMeta>flood_predictions · {riskLabel}</CardMeta>
            </div>
            <CloudRain className="fps-3d-icon h-9 w-9 text-indigo-600 drop-shadow-sm dark:text-indigo-400" />
          </CardHeader>
          <div className="flex items-center gap-3">
            <RiskBadge level={riskSummary.overall} />
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {t('dashboard.overall')}: {t(`risk.${riskSummary.overall}`)}
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {(['safe', 'medium', 'high', 'severe'] as const).map((level) => {
              const count = riskSummary[level] ?? 0
              const total = (riskSummary.safe ?? 0) + (riskSummary.medium ?? 0) + (riskSummary.high ?? 0) + (riskSummary.severe ?? 0)
              const pct = total > 0 ? Math.round((count / total) * 100) : 0
              const barColor = { safe: 'bg-green-500', medium: 'bg-amber-400', high: 'bg-orange-500', severe: 'bg-rose-600' }[level]
              const label = { safe: 'An toàn', medium: 'Trung bình', high: 'Cao', severe: 'Nghiêm trọng' }[level]
              return (
                <div key={level} className="space-y-0.5">
                  <div className="flex justify-between text-xs text-slate-600 dark:text-slate-300">
                    <span>{label}</span>
                    <span className="font-mono">{count.toLocaleString()} ({pct}%)</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      </div>

      {/* ── Hàng 3: Nhiệt độ/Độ ẩm | Xu hướng nguy cơ ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Nhiệt độ & Độ ẩm</CardTitle>
              <CardMeta>{riskLabel} · weather_measurements (CockroachDB)</CardMeta>
            </div>
          </CardHeader>
          <div className="h-52 min-h-[13rem]">
            <TempHumidityChart points={tempHum} />
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Xu hướng nguy cơ ngập</CardTitle>
              <CardMeta>{hours <= 48 ? riskLabel : '7 ngày qua'} · flood_predictions (CockroachDB)</CardMeta>
            </div>
          </CardHeader>
          <div className="h-52 min-h-[13rem]">
            <RiskTrendChart days={riskTrend} />
          </div>
        </Card>
      </div>
    </>
  )
}
