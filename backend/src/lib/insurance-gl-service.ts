/**
 * insurance-gl-service.ts — admin-v1 §7.x (Option A: clinic carries the receivable).
 *
 * Insurer billed (a reconciliation entry, which funds the patient's wallet credit):
 *   DR 1210 AR-Insurance      (party=insurance) — the insurer owes the clinic
 *   CR 2200 Patient Deposits  (party=patient)   — matches the wallet credit given
 *
 * Insurer pays:
 *   DR 1010 Bank
 *   CR 1210 AR-Insurance       (party=insurance) — clears the receivable
 *
 * 1210 + 2200 are CONTROL accounts, so every line carries its party. Idempotent on
 * the reconciliation id (distinct source types for claim vs payment). Best-effort
 * with the open-period fallback so nothing is silently dropped.
 */

import { Money } from '@denel/utils'
import { and, eq } from 'drizzle-orm'
import type { DB } from '../db'
import { journalEntries } from '../db/schema'
import { getAccountByCode, resolveChannelAccountId } from './channel-accounts'
import { FINANCE_ACCOUNTS } from './finance-accounts'
import { postInOpenPeriod, reverseJournalEntry } from './gl-service'

async function tryAccountId(db: DB, code: string): Promise<string | null> {
  try {
    const a = await getAccountByCode(db, code)
    return a?.id ?? null
  } catch {
    return null
  }
}

/** Insurer billed → receivable + patient credit. */
export async function postInsuranceReceivable(
  db: DB,
  p: {
    reconciliationId: string
    companyId: string
    patientId: string
    amount: number
    date: Date
    createdBy: string
  }
): Promise<{ posted: boolean }> {
  if (!p.amount || p.amount <= 0) return { posted: false }
  const arIns = await tryAccountId(db, FINANCE_ACCOUNTS.AR_INSURANCE)
  const deposits = await tryAccountId(db, FINANCE_ACCOUNTS.PATIENT_DEPOSITS)
  if (!arIns || !deposits) return { posted: false }

  const money = Money.from(p.amount)
  const outcome = await postInOpenPeriod(
    db,
    {
      sourceDocType: 'insurance_claim',
      sourceDocId: p.reconciliationId,
      description: 'Insurance covered amount (insurer billed)',
      createdBy: p.createdBy,
      lines: [
        {
          accountId: arIns,
          debit: money,
          partyType: 'insurance',
          partyId: p.companyId,
          description: 'Insurer owes (covered amount)',
        },
        {
          accountId: deposits,
          credit: money,
          partyType: 'patient',
          partyId: p.patientId,
          description: 'Patient credit (insurance-funded)',
        },
      ],
    },
    p.date
  )
  return { posted: outcome === 'posted' }
}

/** Insurer pays → clear the receivable. */
export async function postInsurancePayment(
  db: DB,
  p: {
    reconciliationId: string
    companyId: string
    amount: number
    date: Date
    createdBy: string
  }
): Promise<{ posted: boolean }> {
  if (!p.amount || p.amount <= 0) return { posted: false }
  let bank: string | null = null
  try {
    bank = await resolveChannelAccountId(db, 'bank_transfer')
  } catch {
    bank = null
  }
  const arIns = await tryAccountId(db, FINANCE_ACCOUNTS.AR_INSURANCE)
  if (!bank || !arIns) return { posted: false }

  const money = Money.from(p.amount)
  const outcome = await postInOpenPeriod(
    db,
    {
      sourceDocType: 'insurance_payment',
      sourceDocId: p.reconciliationId,
      description: 'Insurer payment received',
      createdBy: p.createdBy,
      lines: [
        { accountId: bank, debit: money, description: 'Insurer payment' },
        {
          accountId: arIns,
          credit: money,
          partyType: 'insurance',
          partyId: p.companyId,
          description: 'Clear insurer receivable',
        },
      ],
    },
    p.date
  )
  return { posted: outcome === 'posted' }
}

/**
 * Insurer under-paid (or denied) the agreed amount → write the gap off to bad debt
 * so the 1210 receivable clears fully (the clinic absorbs it; the patient is never
 * billed the difference). Idempotent on its own source type.
 */
export async function postInsuranceShortfall(
  db: DB,
  p: {
    reconciliationId: string
    companyId: string
    amount: number
    date: Date
    createdBy: string
  }
): Promise<{ posted: boolean }> {
  if (!p.amount || p.amount <= 0) return { posted: false }
  const badDebt = await tryAccountId(db, FINANCE_ACCOUNTS.BAD_DEBT_EXPENSE)
  const arIns = await tryAccountId(db, FINANCE_ACCOUNTS.AR_INSURANCE)
  if (!badDebt || !arIns) return { posted: false }

  const money = Money.from(p.amount)
  const outcome = await postInOpenPeriod(
    db,
    {
      sourceDocType: 'insurance_shortfall',
      sourceDocId: p.reconciliationId,
      description: 'Insurance shortfall written off',
      createdBy: p.createdBy,
      lines: [
        { accountId: badDebt, debit: money, description: 'Insurance shortfall (write-off)' },
        {
          accountId: arIns,
          credit: money,
          partyType: 'insurance',
          partyId: p.companyId,
          description: 'Clear unrecoverable insurer receivable',
        },
      ],
    },
    p.date
  )
  return { posted: outcome === 'posted' }
}

const INSURANCE_SOURCE_TYPES = [
  'insurance_claim',
  'insurance_payment',
  'insurance_shortfall',
] as const

/**
 * Reverse every live (non-reversed) insurance GL entry for a reconciliation — used
 * when the reconciliation is deleted so nothing is orphaned. Reverses in each
 * entry's own period; a closed month throws (the caller surfaces it).
 */
export async function reverseInsuranceGL(
  db: DB,
  reconciliationId: string,
  createdBy: string
): Promise<void> {
  for (const sourceDocType of INSURANCE_SOURCE_TYPES) {
    const entries = await db.query.journalEntries.findMany({
      where: and(
        eq(journalEntries.sourceDocType, sourceDocType),
        eq(journalEntries.sourceDocId, reconciliationId),
        eq(journalEntries.isReversal, false)
      ),
    })
    for (const e of entries) {
      const already = await db.query.journalEntries.findFirst({
        where: eq(journalEntries.reversesEntryId, e.id),
      })
      if (!already) {
        await reverseJournalEntry(db, e.id, { createdBy, reversalDate: new Date(e.entryDate) })
      }
    }
  }
}
