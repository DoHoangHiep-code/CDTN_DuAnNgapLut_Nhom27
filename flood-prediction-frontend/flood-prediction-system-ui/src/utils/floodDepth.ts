import type { RiskLevel } from './types'

export function depthCmFromRainfall(mm: number, risk: RiskLevel): number {
  // Demo mapping:
  // - Rainfall (mm) -> baseline depth (cm)
  // - Risk level scales the depth up/down to better match "severe" visuals
  const baseline = mm * 0.8 // e.g. 60mm -> ~48cm
  const riskMult = risk === 'severe' ? 1.2 : risk === 'high' ? 1.0 : risk === 'medium' ? 0.78 : 0.6
  return Math.max(0, Math.round(baseline * riskMult))
}

export function formatDepthCm(depthCm: number): string {
  return `${Math.max(0, Math.round(depthCm))}cm`
}

