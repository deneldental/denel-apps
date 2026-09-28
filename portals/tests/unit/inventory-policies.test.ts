/**
 * settings-domain-audit S5-B (inventory): the portal's reading of
 * `inventory:policies` — expiry classification, defaults merging and the
 * stock-adjustment validation the Adjust stock sheet runs.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INVENTORY_POLICIES,
  expiryStatus,
  mergeInventoryPolicies,
  validateAdjustment,
} from '@/features/inventory/policies'

const policies = { expiryWarningDays: 90, criticalExpiryDays: 30 }
const now = new Date('2026-09-23T12:00:00Z')

describe('expiryStatus', () => {
  it('classifies by the configured windows', () => {
    expect(expiryStatus('2026-10-03T00:00:00Z', policies, now)).toEqual({
      daysUntil: 10,
      level: 'critical',
    })
    expect(expiryStatus('2026-11-10T00:00:00Z', policies, now)).toEqual({
      daysUntil: 48,
      level: 'warning',
    })
    expect(expiryStatus('2027-03-01T00:00:00Z', policies, now).level).toBe('ok')
  })

  it('treats an already-expired batch as critical', () => {
    expect(expiryStatus('2026-09-20T00:00:00Z', policies, now)).toEqual({
      daysUntil: -3,
      level: 'critical',
    })
  })

  it('has nothing to say without an expiry date', () => {
    expect(expiryStatus(null, policies, now)).toEqual({ daysUntil: null, level: 'ok' })
  })
})

describe('mergeInventoryPolicies', () => {
  it('fills defaults and drops malformed fields', () => {
    expect(mergeInventoryPolicies(null)).toEqual(DEFAULT_INVENTORY_POLICIES)
    expect(
      mergeInventoryPolicies({
        expiryWarningDays: 45,
        valuationMethod: 'weighted_average',
        adjustmentReasons: ['Spill', ''],
      })
    ).toEqual({
      expiryWarningDays: 45,
      criticalExpiryDays: 30,
      valuationMethod: 'weighted_average',
      adjustmentReasons: ['Spill'],
    })
  })
})

describe('validateAdjustment', () => {
  it('computes the delta for a new count and refuses a no-op', () => {
    expect(
      validateAdjustment({ mode: 'set', quantity: '7', current: 10, reason: 'Count Variance' })
    ).toEqual({ delta: -3, resulting: 7, problem: null })
    expect(
      validateAdjustment({ mode: 'set', quantity: '10', current: 10, reason: 'x' }).problem
    ).toMatch(/no change/i)
  })

  it('refuses a removal that exceeds stock, a fractional count and a missing reason', () => {
    expect(
      validateAdjustment({ mode: 'delta', quantity: '-11', current: 10, reason: 'x' }).problem
    ).toMatch(/only 10/i)
    expect(
      validateAdjustment({ mode: 'set', quantity: '2.5', current: 10, reason: 'x' }).problem
    ).toMatch(/whole/i)
    expect(
      validateAdjustment({ mode: 'delta', quantity: '2', current: 10, reason: '' }).problem
    ).toMatch(/reason/i)
  })
})
