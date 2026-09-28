/**
 * settings-domain-audit B9: `setLowStockThreshold` used to do
 * `Math.max(0, Math.floor(Number(value)))`, so a non-numeric value became
 * `NaN` (stored as JSON null, cached as NaN, answered with `success: true`)
 * and a negative one was silently clamped to 0. The route validates first,
 * but the setter is the last line of defence and must refuse too.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/config/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://localhost:5432/test',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
    BETTER_AUTH_URL: 'http://localhost:3000',
    NODE_ENV: 'test',
  },
  validateBackendEnv: vi.fn(),
}))

import {
  getAuditRetentionDays,
  getDefaultLabTurnaroundDays,
  getInventoryPolicies,
  normalizeInventoryPolicies,
  setLowStockThreshold,
} from '../../src/lib/settings-store'

const upserts: Array<Record<string, unknown>> = []
const fakeDb = {
  insert: vi.fn(() => ({
    values: vi.fn((row: Record<string, unknown>) => {
      upserts.push(row)
      return { onConflictDoUpdate: vi.fn(async () => undefined) }
    }),
  })),
} as unknown as Parameters<typeof setLowStockThreshold>[0]

describe('setLowStockThreshold', () => {
  afterEach(() => {
    upserts.length = 0
  })

  it('rejects a non-finite value instead of storing NaN', async () => {
    await expect(setLowStockThreshold(fakeDb, Number.NaN, 'u-1')).rejects.toThrow(/non-negative/)
    expect(upserts).toHaveLength(0)
  })

  it('rejects a negative value instead of clamping it', async () => {
    await expect(setLowStockThreshold(fakeDb, -1, 'u-1')).rejects.toThrow(/non-negative/)
    expect(upserts).toHaveLength(0)
  })

  it('stores the floor of a valid value', async () => {
    await expect(setLowStockThreshold(fakeDb, 7.9, 'u-1')).resolves.toBe(7)
    expect(upserts[0]).toMatchObject({ value: 7, updatedById: 'u-1' })
  })
})

/** A db whose `select().from().where().limit()` resolves to `rows`. */
function dbSelecting(rows: Array<{ value: unknown }>) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(async () => rows) })),
      })),
    })),
  } as unknown as Parameters<typeof getAuditRetentionDays>[0]
}

// settings-domain-audit S5: `security:audit_retention` is read by the monthly
// audit-retention job through this accessor.
describe('getAuditRetentionDays', () => {
  it('maps the stored period to days', async () => {
    expect(
      await getAuditRetentionDays(dbSelecting([{ value: { retentionPeriod: '90_days' } }]))
    ).toBe(90)
    expect(
      await getAuditRetentionDays(dbSelecting([{ value: { retentionPeriod: '180_days' } }]))
    ).toBe(180)
    expect(
      await getAuditRetentionDays(dbSelecting([{ value: { retentionPeriod: '1_year' } }]))
    ).toBe(365)
  })

  it('returns null for "indefinite" so the job never purges', async () => {
    expect(
      await getAuditRetentionDays(dbSelecting([{ value: { retentionPeriod: 'indefinite' } }]))
    ).toBeNull()
  })

  it('falls back to 365 days when the row is missing or malformed', async () => {
    expect(await getAuditRetentionDays(dbSelecting([]))).toBe(365)
    expect(
      await getAuditRetentionDays(dbSelecting([{ value: { retentionPeriod: 'forever' } }]))
    ).toBe(365)
    expect(await getAuditRetentionDays(dbSelecting([{ value: 'junk' }]))).toBe(365)
  })
})

// settings-domain-audit S5-B: `inventory:policies` is read by the inventory
// ledger (valuation method) and served to the portal (expiry windows, reasons).
describe('inventory policies', () => {
  const defaults = {
    expiryWarningDays: 90,
    criticalExpiryDays: 30,
    valuationMethod: 'fifo',
    adjustmentReasons: [
      'Count Variance',
      'Expired Stock',
      'Damaged / Broken',
      'Internal Clinic Use',
      'Donation',
    ],
  }

  it('returns the defaults when nothing is stored', async () => {
    expect(await getInventoryPolicies(dbSelecting([]))).toEqual(defaults)
  })

  it('keeps every valid stored field', async () => {
    const stored = {
      expiryWarningDays: 45,
      criticalExpiryDays: 10,
      valuationMethod: 'weighted_average',
      adjustmentReasons: ['Breakage'],
    }
    expect(await getInventoryPolicies(dbSelecting([{ value: stored }]))).toEqual(stored)
  })

  it('falls back field by field on malformed values', () => {
    expect(
      normalizeInventoryPolicies({
        expiryWarningDays: -1,
        criticalExpiryDays: 'soon',
        valuationMethod: 'lifo',
        adjustmentReasons: ['', 7, ' Spill '],
      })
    ).toEqual({ ...defaults, adjustmentReasons: ['Spill'] })
    expect(normalizeInventoryPolicies('junk')).toEqual(defaults)
  })
})

// settings-domain-audit S5-B (clinical): the lab-case creation route's final
// turnaround fallback reads `clinical:charting_preferences.defaultLabTurnaroundDays`.
describe('getDefaultLabTurnaroundDays', () => {
  it('reads the configured days', async () => {
    expect(
      await getDefaultLabTurnaroundDays(dbSelecting([{ value: { defaultLabTurnaroundDays: 12 } }]))
    ).toBe(12)
  })

  it('falls back to 7 when unset, zero or malformed', async () => {
    expect(await getDefaultLabTurnaroundDays(dbSelecting([]))).toBe(7)
    expect(
      await getDefaultLabTurnaroundDays(dbSelecting([{ value: { defaultLabTurnaroundDays: 0 } }]))
    ).toBe(7)
    expect(
      await getDefaultLabTurnaroundDays(dbSelecting([{ value: { defaultLabTurnaroundDays: 'x' } }]))
    ).toBe(7)
  })
})
