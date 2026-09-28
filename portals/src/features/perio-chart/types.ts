import {
  DEFAULT_PERIO,
  type PerioThresholds,
  perioDepthClass,
} from '@/features/clinical/preferences'
export type PerioSite = 'MB' | 'B' | 'DB' | 'ML' | 'L' | 'DL'

export interface PerioReading {
  id: string
  patientId: string
  examId: string
  toothNumber: number
  site: PerioSite
  pocketDepth: number
  recordedById: string | null
  recordedAt: string
}

export interface PerioExam {
  examId: string
  recordedAt: string
  entries: PerioReading[]
}

export const PERIO_SITES: PerioSite[] = ['MB', 'B', 'DB', 'ML', 'L', 'DL']
// Buccal-facing sites vs. lingual-facing (for grid layout)
export const BUCCAL_SITES: PerioSite[] = ['MB', 'B', 'DB']
export const LINGUAL_SITES: PerioSite[] = ['ML', 'L', 'DL']

export const SITE_LABELS: Record<PerioSite, string> = {
  MB: 'Mesio-Buccal',
  B: 'Buccal',
  DB: 'Disto-Buccal',
  ML: 'Mesio-Lingual',
  L: 'Lingual',
  DL: 'Disto-Lingual',
}

// FDI tooth numbers in anatomical order
export const UPPER_TEETH = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]
export const LOWER_TEETH = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]

// Color scale for pocket depth (mm) — the thresholds come from Settings →
// Clinical → Charting Preferences (settings-domain-audit S5-B).
export function depthColor(depth: number, thresholds: PerioThresholds = DEFAULT_PERIO): string {
  return perioDepthClass(depth, thresholds)
}
