/**
 * `clinical:charting_preferences` and `clinical:perio_thresholds` as the portal
 * reads them (Settings → Clinical → Charting Preferences). Storage stays FDI;
 * the notation only changes labels (settings-domain-audit S5-B).
 */
import { isToothNotation, type ToothNotation } from '@denel/utils'

export const CHARTING_KEY = 'clinical:charting_preferences'
export const PERIO_KEY = 'clinical:perio_thresholds'

export interface ChartingPreferences {
  notationSystem: ToothNotation
  /** Stored for when primary dentition charting exists; nothing reads it yet. */
  deciduousNotation: 'fdi' | 'letter'
  /** Prefills the duration of a new drug row in the case prescription stage. */
  defaultPrescriptionDays: number
  /** Final fallback for a lab case's turnaround when no offering/service has one. */
  defaultLabTurnaroundDays: number
}

export interface PerioThresholds {
  normalMaxMm: number
  moderateMaxMm: number
  severeMinMm: number
}

export const DEFAULT_CHARTING: ChartingPreferences = {
  notationSystem: 'fdi',
  deciduousNotation: 'fdi',
  defaultPrescriptionDays: 5,
  defaultLabTurnaroundDays: 7,
}

export const DEFAULT_PERIO: PerioThresholds = {
  normalMaxMm: 3,
  moderateMaxMm: 5,
  severeMinMm: 6,
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback
}

/** Field by field; the retired SLA fields of older rows are ignored. */
export function mergeChartingPreferences(stored: unknown): ChartingPreferences {
  const r = typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {}
  return {
    notationSystem: isToothNotation(r.notationSystem) ? r.notationSystem : 'fdi',
    deciduousNotation: r.deciduousNotation === 'letter' ? 'letter' : 'fdi',
    defaultPrescriptionDays: positiveInt(
      r.defaultPrescriptionDays,
      DEFAULT_CHARTING.defaultPrescriptionDays
    ),
    defaultLabTurnaroundDays: positiveInt(
      r.defaultLabTurnaroundDays,
      DEFAULT_CHARTING.defaultLabTurnaroundDays
    ),
  }
}

/** All three must be positive and strictly ordered, else the defaults apply. */
export function mergePerioThresholds(stored: unknown): PerioThresholds {
  const r = typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {}
  const t = {
    normalMaxMm: positiveInt(r.normalMaxMm, DEFAULT_PERIO.normalMaxMm),
    moderateMaxMm: positiveInt(r.moderateMaxMm, DEFAULT_PERIO.moderateMaxMm),
    severeMinMm: positiveInt(r.severeMinMm, DEFAULT_PERIO.severeMinMm),
  }
  return t.normalMaxMm < t.moderateMaxMm && t.moderateMaxMm < t.severeMinMm ? t : DEFAULT_PERIO
}

export type PerioLevel = 'healthy' | 'moderate' | 'severe'

/** ≤ normal max → healthy; ≥ severe min → severe; anything between → moderate. */
export function perioLevel(depthMm: number, t: PerioThresholds): PerioLevel {
  if (depthMm <= t.normalMaxMm) return 'healthy'
  if (depthMm >= t.severeMinMm) return 'severe'
  return 'moderate'
}

export const PERIO_LEVEL_CLASSES: Record<PerioLevel, string> = {
  healthy: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200',
  moderate: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200',
  severe: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200',
}

export function perioDepthClass(depthMm: number, t: PerioThresholds): string {
  return PERIO_LEVEL_CLASSES[perioLevel(depthMm, t)]
}

/** Legend ranges in mm, e.g. `1–3` / `4–5` / `6+`. */
export function perioLegend(t: PerioThresholds): Record<PerioLevel, string> {
  const moderateFrom = t.normalMaxMm + 1
  return {
    healthy: `1–${t.normalMaxMm}`,
    moderate:
      t.moderateMaxMm > moderateFrom ? `${moderateFrom}–${t.moderateMaxMm}` : `${moderateFrom}`,
    severe: `${t.severeMinMm}+`,
  }
}
