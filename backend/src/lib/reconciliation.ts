/**
 * reconciliation.ts
 *
 * Asserts the spec's core invariant (§8.12): every control account's GL
 * balance equals the sum of its sub-ledger balances.
 *
 * Phase 1 covers only the `2200 Patient Deposits` control account — its
 * sub-ledger is the existing `patient_wallets.credit_balance` column. Other
 * sub-ledgers (AR per patient, AP per supplier, commission per specialist)
 * arrive in Phases 2–7; each phase plugs in another sub-ledger query here.
 */

import type { ReconciliationDrift, ReconciliationReport } from '@denel/types'
import { Money } from '@denel/utils'
import { eq, sql } from 'drizzle-orm'
import type { DB } from '../db'
import {
  accounts,
  journalLines,
  patientBalances,
  patientWallets,
  specialistBalances,
  supplierBalances,
} from '../db/schema'
import { FINANCE_ACCOUNTS } from './finance-accounts'

const ZERO = Money.zero()
const TOLERANCE = Money.fromString('0.005')

type SubLedgerProbe = {
  accountCode: string
  fetchBalance: (db: DB) => Promise<Money>
}

/**
 * Each entry is the sub-ledger query for a specific control account. As new
 * phases land, append additional probes here.
 */
const SUB_LEDGER_PROBES: SubLedgerProbe[] = [
  {
    accountCode: FINANCE_ACCOUNTS.AR, // AR — Patients. Sub-ledger: patient_balances.ar_balance.
    fetchBalance: async (db) => {
      const rows = await db
        .select({ total: sql<string | null>`COALESCE(SUM(${patientBalances.arBalance}), 0)` })
        .from(patientBalances)
      return Money.fromDb(rows[0]?.total ?? '0')
    },
  },
  {
    accountCode: FINANCE_ACCOUNTS.PATIENT_DEPOSITS, // Patient Deposits (Unapplied). Sub-ledger: patient_wallets.credit_balance.
    fetchBalance: async (db) => {
      const rows = await db
        .select({ total: sql<string | null>`COALESCE(SUM(${patientWallets.creditBalance}), 0)` })
        .from(patientWallets)
      return Money.fromDb(rows[0]?.total ?? '0')
    },
  },
  {
    accountCode: FINANCE_ACCOUNTS.AP, // AP — Suppliers. Sub-ledger: supplier_balances.ap_balance.
    fetchBalance: async (db) => {
      const rows = await db
        .select({ total: sql<string | null>`COALESCE(SUM(${supplierBalances.apBalance}), 0)` })
        .from(supplierBalances)
      return Money.fromDb(rows[0]?.total ?? '0')
    },
  },
  {
    accountCode: FINANCE_ACCOUNTS.COMMISSION_PAYABLE, // Commission Payable — Specialists.
    // Sub-ledger: specialist_balances.accrued + payable (the GL has both
    // outstanding portions of every commission; paid commissions have already
    // moved out via the payout JE).
    fetchBalance: async (db) => {
      const rows = await db
        .select({
          total: sql<
            string | null
          >`COALESCE(SUM(${specialistBalances.accruedAmount} + ${specialistBalances.payableAmount}), 0)`,
        })
        .from(specialistBalances)
      return Money.fromDb(rows[0]?.total ?? '0')
    },
  },
]

export async function runHealthCheck(db: DB): Promise<ReconciliationReport> {
  const drifts: ReconciliationDrift[] = []

  for (const probe of SUB_LEDGER_PROBES) {
    const accountRow = await db.query.accounts.findFirst({
      where: eq(accounts.code, probe.accountCode),
    })
    if (!accountRow) continue

    const glBalance = await fetchControlAccountBalance(db, accountRow.id, accountRow.normalBalance)
    const subBalance = await probe.fetchBalance(db)
    const drift = glBalance.sub(subBalance).abs()

    if (drift.gt(TOLERANCE)) {
      drifts.push({
        accountCode: accountRow.code,
        accountName: accountRow.name,
        glBalance: glBalance.toString(),
        subledgerBalance: subBalance.toString(),
        drift: drift.toString(),
      })
    }
  }

  return {
    ranAt: new Date().toISOString(),
    drifts,
    ok: drifts.length === 0,
  }
}

/**
 * Sum DR - CR (asset/expense) or CR - DR (liability/equity/revenue) for a
 * single account across all journal lines.
 */
export async function fetchControlAccountBalance(
  db: DB,
  accountId: string,
  normalBalance: string
): Promise<Money> {
  const rows = await db
    .select({
      debit: sql<string | null>`COALESCE(SUM(${journalLines.debit}), 0)`,
      credit: sql<string | null>`COALESCE(SUM(${journalLines.credit}), 0)`,
    })
    .from(journalLines)
    .where(eq(journalLines.accountId, accountId))

  const debit = Money.fromDb(rows[0]?.debit ?? '0')
  const credit = Money.fromDb(rows[0]?.credit ?? '0')
  return normalBalance === 'debit' ? debit.sub(credit) : credit.sub(debit)
}

/**
 * Defensive check used by tests: every journal entry has SUM(debit) =
 * SUM(credit). Returns the entry IDs that violate the invariant (empty array
 * on success).
 */
export async function findUnbalancedEntries(db: DB): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT entry_id
    FROM journal_lines
    GROUP BY entry_id
    HAVING SUM(debit) <> SUM(credit)
  `)
  const out: string[] = []
  const list =
    (rows as unknown as { rows?: { entry_id: string }[] }).rows ??
    (Array.isArray(rows) ? (rows as unknown as { entry_id: string }[]) : [])
  for (const r of list) out.push(r.entry_id)
  return out
}

export { ZERO as RECONCILIATION_ZERO }
