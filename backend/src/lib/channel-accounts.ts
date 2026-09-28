/**
 * channel-accounts.ts
 *
 * Maps a payment method (cash, momo, bank_transfer, etc.) to the GL cash /
 * bank / clearing account that the payment hits. Loads codes from the Chart
 * of Accounts at runtime; new clinics can override the mapping in `settings`
 * later without code changes.
 */

import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import type { DB } from '../db'
import { accounts, paymentMethods } from '../db/schema'

export type PaymentMethod =
  | 'cash'
  | 'card'
  | 'insurance'
  | 'transfer'
  | 'momo'
  | 'bank_transfer'
  | 'cheque'
  /** Pays from the patient's existing deposit balance (2200 Patient Deposits).
   *  Functionally equivalent to the old `apply-credit` flow but surfaces in the
   *  transactions list with its own receipt, so the user sees every movement. */
  | 'wallet'

const METHOD_TO_CODE: Record<PaymentMethod, string> = {
  cash: '1000',
  card: '1030',
  momo: '1020',
  bank_transfer: '1010',
  transfer: '1010',
  cheque: '1010',
  insurance: '1210',
  /** Wallet payments hit Patient Deposits directly — DR Deposits / CR AR. */
  wallet: '2200',
}

/**
 * Resolve the GL account ID for a given payment method.
 *
 * Account-CODE precedence:
 *   1. the `glAccountCode` an admin pinned on the `payment_methods` lookup row
 *      whose `name` equals `method` (only when it's non-NULL). This is what lets
 *      admin-created slugs — `mobile_money`, `hubtel_pos`, … — post to the right
 *      channel instead of silently landing on Cash.
 *   2. else `METHOD_TO_CODE[method]` — the closed map of the 8 canonical /
 *      legacy slugs (cash, card, insurance, transfer, momo, bank_transfer,
 *      cheque, wallet), kept so those keep resolving with no lookup row needed.
 *   3. else `'1000'` (Cash on Hand).
 *
 * The resolved CODE is then looked up in the Chart of Accounts. If that code
 * isn't seeded, we fall back to the `'1000'` account; if even that is missing,
 * we throw (the CoA needs seeding).
 *
 * Signature is unchanged — callers pass whatever `method` string they hold
 * (many cast through `PaymentMethod`); an unknown slug just flows to step 2/3.
 */
export async function resolveChannelAccountId(db: DB, method: PaymentMethod): Promise<string> {
  const [configured] = await db
    .select({ glAccountCode: paymentMethods.glAccountCode })
    .from(paymentMethods)
    .where(and(eq(paymentMethods.name, method), isNotNull(paymentMethods.glAccountCode)))
    .limit(1)

  const code = configured?.glAccountCode ?? METHOD_TO_CODE[method] ?? '1000'
  const codes = [code, '1000']
  const rows = await db
    .select({ id: accounts.id, code: accounts.code })
    .from(accounts)
    .where(inArray(accounts.code, codes))

  const exact = rows.find((r) => r.code === code)
  if (exact) return exact.id

  const fallback = rows.find((r) => r.code === '1000')
  if (fallback) return fallback.id

  throw new Error(`No channel account found for method "${method}" — seed the CoA`)
}

/**
 * Convenience accessor for finding a control account by code (1200 AR,
 * 2200 Patient Deposits, etc.).
 */
export async function getAccountByCode(db: DB, code: string) {
  const row = await db.query.accounts.findFirst({ where: eq(accounts.code, code) })
  if (!row) throw new Error(`Account ${code} not found — seed the CoA`)
  return row
}
