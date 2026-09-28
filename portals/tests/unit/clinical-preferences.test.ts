/**
 * settings-domain-audit S5-B (clinical): the portal's reading of
 * `clinical:charting_preferences` and `clinical:perio_thresholds`.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CHARTING,
  DEFAULT_PERIO,
  mergeChartingPreferences,
  mergePerioThresholds,
  perioLegend,
  perioLevel,
} from '@/features/clinical/preferences'

describe('mergeChartingPreferences', () => {
  it('fills defaults and ignores the retired SLA fields', () => {
    expect(mergeChartingPreferences(null)).toEqual(DEFAULT_CHARTING)
    expect(
      mergeChartingPreferences({
        notationSystem: 'universal',
        crownSlaDays: 5,
        defaultPrescriptionDays: 7,
      })
    ).toEqual({
      notationSystem: 'universal',
      deciduousNotation: 'fdi',
      defaultPrescriptionDays: 7,
      defaultLabTurnaroundDays: 7,
    })
    expect(mergeChartingPreferences({ notationSystem: 'roman' }).notationSystem).toBe('fdi')
  })
})

describe('mergePerioThresholds', () => {
  it('keeps a sane ordering and falls back otherwise', () => {
    expect(mergePerioThresholds(null)).toEqual(DEFAULT_PERIO)
    expect(mergePerioThresholds({ normalMaxMm: 2, moderateMaxMm: 4, severeMinMm: 5 })).toEqual({
      normalMaxMm: 2,
      moderateMaxMm: 4,
      severeMinMm: 5,
    })
    expect(mergePerioThresholds({ normalMaxMm: 6, moderateMaxMm: 4, severeMinMm: 5 })).toEqual(
      DEFAULT_PERIO
    )
  })
})

describe('perioLevel / perioLegend', () => {
  const t = { normalMaxMm: 3, moderateMaxMm: 5, severeMinMm: 6 }

  it('classifies a reading by the thresholds', () => {
    expect(perioLevel(3, t)).toBe('healthy')
    expect(perioLevel(4, t)).toBe('moderate')
    expect(perioLevel(5, t)).toBe('moderate')
    expect(perioLevel(6, t)).toBe('severe')
    expect(perioLevel(9, t)).toBe('severe')
  })

  it('treats a gap between the moderate maximum and the severe minimum as moderate', () => {
    expect(perioLevel(6, { normalMaxMm: 3, moderateMaxMm: 5, severeMinMm: 7 })).toBe('moderate')
  })

  it('renders the legend ranges from the thresholds', () => {
    expect(perioLegend(t)).toEqual({ healthy: '1–3', moderate: '4–5', severe: '6+' })
  })
})
