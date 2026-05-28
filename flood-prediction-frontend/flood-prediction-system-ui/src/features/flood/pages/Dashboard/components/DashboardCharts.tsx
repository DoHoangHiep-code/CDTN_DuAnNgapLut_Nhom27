import { CloudRain } from 'lucide-react'
import { Card, CardHeader, CardMeta, CardTitle } from '../../../../../components/common/Card'
import { RiskBadge } from '../../../../../components/common/Badge'
import { RainForecastChart } from './RainForecastChart'
import { TempHumidityChart } from './TempHumidityChart'
import { RiskTrendChart } from './RiskTrendChart'
import { ChartWrapper } from './ChartWrapper'
import { useTranslation } from 'react-i18next'
import { PieChart, Pie, Cell, Tooltip, Legend } from 'recharts'

type DashboardChartsProps = {
  forecast24h: any[]
  tempHum: any[]
  riskTrend: any[]
  riskSummary: any
  riskLabel: string
  hours: number
}

const PIE_DATA = (riskSummary: any) => [
  { name: 'An toàn',      value: riskSummary.safe    ?? 0, color: '#10b981' },
  { name: 'Trung bình',   value: riskSummary.medium  ?? 0, color: '#fbbf24' },
  { name: 'Cao',          value: riskSummary.high    ?? 0, color: '#f97316' },
  { name: 'Nghiêm trọng', value: riskSummary.severe  ?? 0, color: '#e11d48' },
].filter(d => d.value > 0)

export function DashboardCharts({
  forecast24h,
  tempHum,
  riskTrend,
  riskSummary,
  riskLabel,
  hours
}: DashboardChartsProps) {
  const { t } = useTranslation()
  const pieData = PIE_DATA(riskSummary)

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
          <div className="mt-4 h-48">
            <ChartWrapper className="h-full w-full">
              {({ width, height }) => (
                <PieChart width={width} height={height}>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={70}
                    paddingAngle={5}
                    dataKey="value"
                    stroke="none"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#f8fafc' }}
                    itemStyle={{ fontSize: '13px', color: '#e2e8f0' }}
                  />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                </PieChart>
              )}
            </ChartWrapper>
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
