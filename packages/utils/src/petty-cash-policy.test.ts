import { describe, expect, it } from 'vitest'
import {
  computePettyBalance,
  DEFAULT_PETTY_CASH_POLICY,
  decidePettyReview,
  iouCapReached,
  normalizePettyCashPolicy,
} from './petty-cash-policy'

/**
 * settings-domain-audit S5-B (petty cash): `finance:petty_cash` decides which
 * disbursements need a manager's review, the staff IOU cap and the box balance.
 * Policy amounts are cedis; ledger amounts are pesewas.
 */
describe('normalizePettyCashPolicy', () => {
  it('returns the defaults for nothing and drops malformed fields', () => {
    expect(normalizePettyCashPolicy(null)).toEqual(DEFAULT_PETTY_CASH_POLICY)
    expect(
      normalizePettyCashPolicy({
        singleApprovalLimit: -5,
        maxActiveIousPerStaff: 0,
        defaultFloat: 800.7,
      })
    ).toEqual({ ...DEFAULT_PETTY_CASH_POLICY, defaultFloat: 800.7 })
  })
})

describe('decidePettyReview', () => {
  it('auto-confirms at or below the limit (cedis vs pesewas)', () => {
    expect(decidePettyReview(50_000, 500)).toBe('auto_confirmed')
    expect(decidePettyReview(50_001, 500)).toBe('needs_review')
    expect(decidePettyReview(1, 0)).toBe('needs_review')
  })
})

describe('iouCapReached', () => {
  it('is reached at the cap', () => {
    expect(iouCapReached(1, 2)).toBe(false)
    expect(iouCapReached(2, 2)).toBe(true)
  })
})

describe('computePettyBalance', () => {
  it('subtracts what was spent and compares with the warning level', () => {
    expect(
      computePettyBalance({ floatPesewas: 500_000, spentSincePesewas: 420_000, warningCedis: 1000 })
    ).toEqual({
      balance: 80_000,
      warningPesewas: 100_000,
      belowWarning: true,
    })
    expect(
      computePettyBalance({ floatPesewas: 500_000, spentSincePesewas: 100_000, warningCedis: 1000 })
        .belowWarning
    ).toBe(false)
  })
})
