/**
 * treatment-gate.ts — enforcement for the treatment payment gate.
 *
 * `treatment-funding.ts` decides whether a treatment is funded. This decides
 * what to DO about it: block, allow, or record an override.
 *
 * ── Mode ────────────────────────────────────────────────────────────────────
 * `clinic_settings` key `treatment_gate.mode`:
 *
 *   'log'     (DEFAULT) — never blocks; records what it WOULD have blocked.
 *   'enforce'           — blocks with 402 Payment Required.
 *   'off'               — disabled entirely, records nothing.
 *
 * It ships defaulting to 'log' deliberately. Every case that is mid-treatment
 * on deploy day has an unpaid or unlinked estimate behind it; switching straight
 * to 'enforce' would halt all of them at once. Run in 'log' first, read the
 * warnings, then flip the setting — no deploy required.
 *
 * ── Override ────────────────────────────────────────────────────────────────
 * An admin may proceed anyway with a REQUIRED reason, written to `audit_logs`.
 * Without an escape hatch the first emergency turns into the gate being switched
 * off wholesale, which loses the audit trail entirely.
 */

import { eq } from 'drizzle-orm'
import type { getDb } from '../db'
import { auditLogs, clinicSettings } from '../db/schema'
import { logger } from './logger'
import { type FundingResult, getInvoiceFunding, getPlanFunding } from './treatment-funding'

export const TREATMENT_GATE_MODE_KEY = 'treatment_gate.mode'
export type TreatmentGateMode = 'off' | 'log' | 'enforce'

type Db = ReturnType<typeof getDb>

/** Reads the mode. Defaults to 'log' — see the note above on why not 'enforce'. */
export async function getTreatmentGateMode(db: Db): Promise<TreatmentGateMode> {
  try {
    const [row] = await db
      .select({ value: clinicSettings.value })
      .from(clinicSettings)
      .where(eq(clinicSettings.key, TREATMENT_GATE_MODE_KEY))
      .limit(1)
    const raw = typeof row?.value === 'string' ? row.value : (row?.value as { mode?: string })?.mode
    if (raw === 'enforce' || raw === 'off' || raw === 'log') return raw
  } catch (err) {
    // A settings read failure must not decide clinical access on its own.
    logger.warn({ err }, '[treatment-gate] could not read mode — defaulting to log')
  }
  return 'log'
}

export interface GateOutcome {
  /** True when the caller must stop and return `status`/`body`. */
  blocked: boolean
  status: 402
  body: {
    error: string
    reason: FundingResult['reason']
    invoiceNumber: string | null
    balance: number
    /** Told to the client so the UI can offer the override affordance. */
    overridable: true
  }
}

export interface GateContext {
  db: Db
  userId: string
  /** Only an admin may override. */
  isAdmin: boolean
  /** `{ override: true, overrideReason }` from the request body. */
  override?: boolean
  overrideReason?: string | null
  /** What is being attempted, for the audit entry — e.g. 'plan_item:completed'. */
  action: string
  entityId: string
}

/**
 * Decide whether an action may proceed.
 *
 * Returns `null` to allow. Returns a `GateOutcome` only when the caller should
 * refuse — in 'log' mode that never happens, but the would-be block is logged.
 */
export async function enforceTreatmentGate(
  ctx: GateContext,
  funding: FundingResult
): Promise<GateOutcome | null> {
  if (funding.funded) return null

  const mode = await getTreatmentGateMode(ctx.db)
  if (mode === 'off') return null

  // An override is an admin decision with a stated reason. A blank reason is
  // not an override — it is the gate being bypassed without a record.
  const reason = (ctx.overrideReason ?? '').trim()
  if (ctx.override && ctx.isAdmin && reason.length > 0) {
    await recordOverride(ctx, funding, reason)
    return null
  }

  if (mode === 'log') {
    logger.warn(
      {
        action: ctx.action,
        entityId: ctx.entityId,
        userId: ctx.userId,
        reason: funding.reason,
        invoiceNumber: funding.invoiceNumber,
        balance: funding.balance,
      },
      '[treatment-gate] WOULD BLOCK (mode=log)'
    )
    return null
  }

  return {
    blocked: true,
    status: 402,
    body: {
      error: funding.detail,
      reason: funding.reason,
      invoiceNumber: funding.invoiceNumber,
      balance: funding.balance,
      overridable: true,
    },
  }
}

/** Convenience: gate an action against a treatment plan's estimate. */
export async function gateByPlan(ctx: GateContext, planId: string): Promise<GateOutcome | null> {
  return enforceTreatmentGate(ctx, await getPlanFunding(ctx.db, planId))
}

/** Convenience: gate an action against an invoice directly. */
export async function gateByInvoice(
  ctx: GateContext,
  invoiceId: string
): Promise<GateOutcome | null> {
  return enforceTreatmentGate(ctx, await getInvoiceFunding(ctx.db, invoiceId))
}

/**
 * An override that leaves no trace is indistinguishable from the gate not
 * existing, so this is written before the action is allowed to proceed.
 */
async function recordOverride(
  ctx: GateContext,
  funding: FundingResult,
  reason: string
): Promise<void> {
  try {
    await ctx.db.insert(auditLogs).values({
      userId: ctx.userId,
      action: 'treatment_gate_override',
      module: 'medical_records',
      entityId: ctx.entityId,
      entityName: funding.invoiceNumber,
      reason,
      changes: {
        gatedAction: ctx.action,
        fundingReason: funding.reason,
        invoiceNumber: funding.invoiceNumber,
        balance: funding.balance,
        detail: funding.detail,
      },
    })
  } catch (err) {
    // Never silently swallow: an unrecorded override is the failure mode this
    // whole path exists to prevent.
    logger.error(
      { err, ctx: ctx.action, entityId: ctx.entityId },
      '[treatment-gate] override audit write FAILED'
    )
    throw new Error('Could not record the override. The action was not applied.')
  }
}
