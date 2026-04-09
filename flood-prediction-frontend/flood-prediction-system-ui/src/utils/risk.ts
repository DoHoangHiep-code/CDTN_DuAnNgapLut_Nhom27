import type { RiskLevel } from './types'

export const RISK_ORDER: Record<RiskLevel, number> = {
  safe: 0,
  medium: 1,
  high: 2,
  severe: 3,
}

export function maxRisk(levels: RiskLevel[]): RiskLevel {
  return levels.reduce<RiskLevel>((acc, v) => (RISK_ORDER[v] > RISK_ORDER[acc] ? v : acc), 'safe')
}

export function riskLabel(level: RiskLevel) {
  return level === 'safe' ? 'Safe' : level === 'medium' ? 'Medium' : level === 'high' ? 'High' : 'Severe'
}

