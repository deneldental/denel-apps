/**
 * patient-ar-service.ts
 *
 * Maintains the materialized `patient_balances` table — the per-patient
 * sub-ledger total. Every call that posts a journal entry touching the AR
 * (1200) or Patient Deposits (2200) control accounts MUST update the matching
 * patient row through one of the helpers here so the sub-ledger never drifts
 * from the GL control account.
 *
 * Strategy: incremental deltas applied in the same DB transaction as the
 * posting. A periodic full rebuild (`recomputeFromLedger`) catches drift if
 * something slips through, and is what the reconciliation health check
 * compares against.
 */

import { Money, type MoneyLike } from '@denel/utils'
import { eq, sql } from 'drizzle-orm'
import type { DB } from '../db'
import { accounts, patientBalances } from '../db/schema'

export type PatientBalanceRow = typeof patientBalances.$inferSelect

/**
 * Apply additive deltas (positive or negative) to a patient's balances.
 * Creates the row on first use. The handle is normally the inner tx supplied
 * by an outer posting transaction.
 */
export async function applyDelta(
  db: DB,
  patientId: string,
  delta: { ar?: MoneyLike; deposit?: MoneyLike }
): Promise<void> {
  const arDelta = Money.from(delta.ar ?? 0)
  const depositDelta = Money.from(delta.deposit ?? 0)

  if (arDelta.isZero() && depositDelta.isZero()) return

  await db
    .insert(patientBalances)
    .values({
      patientId,
      arBalance: arDelta.toDbValue(),
      depositBalance: depositDelta.toDbValue(),
    })
    .onConflictDoUpdate({
      target: patientBalances.patientId,
      set: {
        arBalance: sql`${patientBalances.arBalance} + ${arDelta.toDbValue()}`,
        depositBalance: sql`${patientBalances.depositBalance} + ${depositDelta.toDbValue()}`,
        updatedAt: new Date(),
      },
    })
}

export async function getBalance(db: DB, patientId: string): Promise<PatientBalanceRow | null> {
  const row = await db.query.patientBalances.findFirst({
    where: eq(patientBalances.patientId, patientId),
  })
  return row ?? null
}

/**
 * Full recompute from journal lines. Authoritative. Useful after bulk
 * migrations and inside the reconciliation health check.
 *
 * Returns the count of rows written.
 */
export async function recomputeFromLedger(db: DB, patientId?: string): Promise<number> {
  // Find the AR and Deposits control accounts by code.
  const ar = await db.query.accounts.findFirst({ where: eq(accounts.code, '1200') })
  const dep = await db.query.accounts.findFirst({ where: eq(accounts.code, '2200') })
  if (!ar) throw new Error('AR control account (1200) is missing — seed the CoA')
  if (!dep) throw new Error('Patient Deposits account (2200) is missing — seed the CoA')

  // For each patient with activity on either control account, sum the impact.
  // AR is debit-normal: balance = SUM(debit) - SUM(credit).
  // Deposits is credit-normal: balance = SUM(credit) - SUM(debit).
  const patientFilter = patientId ? sql`AND jl.party_id = ${patientId}` : sql``
  const rows = await db.execute<{
    patient_id: string
    ar_balance: string
    deposit_balance: string
  }>(sql`
    SELECT
      jl.party_id::text AS patient_id,
      COALESCE(SUM(CASE WHEN jl.account_id = ${ar.id} THEN jl.debit  - jl.credit ELSE 0 END), 0)::text AS ar_balance,
      COALESCE(SUM(CASE WHEN jl.account_id = ${dep.id} THEN jl.credit - jl.debit  ELSE 0 END), 0)::text AS deposit_balance
    FROM journal_lines jl
    WHERE jl.party_type = 'patient'
      AND jl.account_id IN (${ar.id}, ${dep.id})
      ${patientFilter}
    GROUP BY jl.party_id
  `)

  // M6: one multi-row upsert instead of an INSERT per patient.
  const valueRows = rows.rows.map((row) => ({
    patientId: row.patient_id,
    // The SUM is over `journal_lines.debit/credit`, integer CENTS since 0209,
    // cast to text — so it is a cent count ("15050"), not a decimal cedis
    // string. `fromString` would read it as GH₵15,050.
    arBalance: Money.fromDb(row.ar_balance).toDbValue(),
    depositBalance: Money.fromDb(row.deposit_balance).toDbValue(),
  }))
  if (valueRows.length === 0) return 0
  await db
    .insert(patientBalances)
    .values(valueRows)
    .onConflictDoUpdate({
      target: patientBalances.patientId,
      set: {
        arBalance: sql`excluded.ar_balance`,
        depositBalance: sql`excluded.deposit_balance`,
        updatedAt: new Date(),
      },
    })
  return valueRows.length
}
