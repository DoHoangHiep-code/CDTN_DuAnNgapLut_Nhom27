import { cn } from '../utils/cn'
import type { RiskLevel } from '../utils/types'
import { Badge3D } from './Badge3D'
import { useTranslation } from 'react-i18next'

const RISK_STYLES: Record<RiskLevel, string> = {
  safe: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  medium: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100',
  high: 'bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-100',
  severe: 'bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100',
}

export function RiskBadge({ level, className }: { level: RiskLevel; className?: string }) {
  const { t } = useTranslation()
  const label = t(`risk.${level}`)
  return (
    <Badge3D className={cn(RISK_STYLES[level], className)}>{label}</Badge3D>
  )
}

