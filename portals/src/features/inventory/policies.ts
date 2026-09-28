/**
 * `inventory:policies` as the portal reads it (Settings → Inventory → Store
 * Policies). Defaults and the merge rule mirror the backend's
 * `lib/settings-store.ts` (settings-domain-audit S5-B).
 */

export type ValuationMethod = 'fifo' | 'weighted_average'

export interface InventoryPolicies {
  /** Batches expiring within this many days show on the Expiring soon tab. */
  expiryWarningDays: number
  /** Batches this close to expiry are highlighted red. */
  criticalExpiryDays: number
  valuationMethod: ValuationMethod
  /** Reason codes offered by the Adjust stock sheet. */
  adjustmentReasons: string[]
}

export const INVENTORY_POLICIES_KEY = 'inventory:policies'

export const DEFAULT_INVENTORY_POLICIES: InventoryPolicies = {
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

export const VALUATION_METHOD_LABELS: Record<ValuationMethod, string> = {
  fifo: 'FIFO',
  weighted_average: 'Weighted average',
}

function nonNegativeInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback
}

/** Field by field: a missing or malformed field falls back to its default. */
export function mergeInventoryPolicies(stored: unknown): InventoryPolicies {
  const r = typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {}
  const reasons = Array.isArray(r.adjustmentReasons)
    ? r.adjustmentReasons
        .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
        .map((x) => x.trim())
    : []
  return {
    expiryWarningDays: nonNegativeInt(
      r.expiryWarningDays,
      DEFAULT_INVENTORY_POLICIES.expiryWarningDays
    ),
    criticalExpiryDays: nonNegativeInt(
      r.criticalExpiryDays,
      DEFAULT_INVENTORY_POLICIES.criticalExpiryDays
    ),
    valuationMethod: r.valuationMethod === 'weighted_average' ? 'weighted_average' : 'fifo',
    adjustmentReasons: reasons.length > 0 ? reasons : DEFAULT_INVENTORY_POLICIES.adjustmentReasons,
  }
}

export type ExpiryLevel = 'critical' | 'warning' | 'ok'

const DAY_MS = 24 * 60 * 60 * 1000

/** Days until an expiry date and which policy window it falls in. */
export function expiryStatus(
  expiryDate: string | Date | null | undefined,
  policies: Pick<InventoryPolicies, 'expiryWarningDays' | 'criticalExpiryDays'>,
  now: Date = new Date()
): { daysUntil: number | null; level: ExpiryLevel } {
  if (!expiryDate) return { daysUntil: null, level: 'ok' }
  const expiry = expiryDate instanceof Date ? expiryDate : new Date(expiryDate)
  if (Number.isNaN(expiry.getTime())) return { daysUntil: null, level: 'ok' }
  const daysUntil = Math.ceil((expiry.getTime() - now.getTime()) / DAY_MS)
  if (daysUntil <= policies.criticalExpiryDays) return { daysUntil, level: 'critical' }
  if (daysUntil <= policies.expiryWarningDays) return { daysUntil, level: 'warning' }
  return { daysUntil, level: 'ok' }
}

export interface AdjustmentDraft {
  mode: 'set' | 'delta'
  /** Raw input text. */
  quantity: string
  current: number
  reason: string
}

/** What the Adjust stock sheet checks before it submits; mirrors the route. */
export function validateAdjustment(d: AdjustmentDraft): {
  delta: number | null
  resulting: number | null
  problem: string | null
} {
  const trimmed = d.quantity.trim()
  if (trimmed === '') return { delta: null, resulting: null, problem: 'Enter a quantity' }
  const n = Number(trimmed)
  if (!Number.isInteger(n))
    return { delta: null, resulting: null, problem: 'Quantity must be a whole number' }
  if (d.mode === 'set' && n < 0)
    return { delta: null, resulting: null, problem: 'A count cannot be negative' }
  const delta = d.mode === 'set' ? n - d.current : n
  const resulting = d.current + delta
  if (delta === 0) return { delta, resulting, problem: 'No change: the quantity already matches' }
  if (resulting < 0)
    return { delta, resulting, problem: `Cannot remove ${-delta}: only ${d.current} in stock` }
  if (d.reason.trim() === '') return { delta, resulting, problem: 'Choose a reason' }
  return { delta, resulting, problem: null }
}
