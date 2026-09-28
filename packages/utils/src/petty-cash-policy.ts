/**
 * `finance:petty_cash` (Settings → Finance → Petty Cash Policy) as both the
 * backend and the portal read it — settings-domain-audit S5-B.
 *
 * Policy amounts are entered in CEDIS (the section's labels); ledger amounts
 * are integer PESEWAS. The helpers below do the conversion at the boundary.
 *
 *   singleApprovalLimit       — at/below: a petty disbursement is auto-confirmed;
 *                               above: it waits for a manager's review.
 *   maxActiveIousPerStaff     — pending staff-directed disbursements count as
 *                               active IOUs; at the cap a new one is refused.
 *   defaultFloat / replenishWarningThreshold — the box balance (latest
 *                               replenishment, or the default float) minus
 *                               petty spend since, and when to warn.
 */

export interface PettyCashPolicy {
  /** Cedis. */
  defaultFloat: number
  /** Cedis. */
  singleApprovalLimit: number
  /** Cedis. */
  replenishWarningThreshold: number
  maxActiveIousPerStaff: number
}

export const DEFAULT_PETTY_CASH_POLICY: PettyCashPolicy = {
  defaultFloat: 5000,
  singleApprovalLimit: 500,
  replenishWarningThreshold: 1000,
  maxActiveIousPerStaff: 2,
}

function nonNegative(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : fallback
}

export function normalizePettyCashPolicy(raw: unknown): PettyCashPolicy {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const d = DEFAULT_PETTY_CASH_POLICY
  return {
    defaultFloat: nonNegative(r.defaultFloat, d.defaultFloat),
    singleApprovalLimit: nonNegative(r.singleApprovalLimit, d.singleApprovalLimit),
    replenishWarningThreshold: nonNegative(
      r.replenishWarningThreshold,
      d.replenishWarningThreshold
    ),
    maxActiveIousPerStaff: positiveInt(r.maxActiveIousPerStaff, d.maxActiveIousPerStaff),
  }
}

export function cedisToPesewas(cedis: number): number {
  return Math.round(cedis * 100)
}

export type PettyReviewDecision = 'auto_confirmed' | 'needs_review'

/** Whether a disbursement of `amountPesewas` needs a manager under `limitCedis`. */
export function decidePettyReview(amountPesewas: number, limitCedis: number): PettyReviewDecision {
  return amountPesewas <= cedisToPesewas(limitCedis) ? 'auto_confirmed' : 'needs_review'
}

export function iouCapReached(activeCount: number, max: number): boolean {
  return activeCount >= max
}

export interface PettyBalanceInput {
  floatPesewas: number
  spentSincePesewas: number
  warningCedis: number
}

export function computePettyBalance(i: PettyBalanceInput): {
  balance: number
  warningPesewas: number
  belowWarning: boolean
} {
  const balance = i.floatPesewas - i.spentSincePesewas
  const warningPesewas = cedisToPesewas(i.warningCedis)
  return { balance, warningPesewas, belowWarning: balance < warningPesewas }
}
