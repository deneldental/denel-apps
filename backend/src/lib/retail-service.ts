/**
 * retail-service.ts — admin-v1 Phase 4 (§12.2, Option A periodic).
 *
 * When a store sale is FINALISED (draft -> 'submitted' on daily-report submit), put
 * it on the books: DR Cash / CR Retail Sales Revenue (4200). Periodic inventory —
 * the cost was already expensed when the stock was bought, so no COGS/Inventory line.
 *
 * Idempotent on ('retail_sale', sale.id) via postJournalEntry. Best-effort: a closed
 * period or a missing account comes back as a reason; callers log + continue.
 */

import { Money } from '@denel/utils'
import type { DB } from '../db'
import type { sales } from '../db/schema'
import { getAccountByCode, resolveChannelAccountId } from './channel-accounts'
import { FINANCE_ACCOUNTS } from './finance-accounts'
import { postInOpenPeriod } from './gl-service'

type SaleRow = typeof sales.$inferSelect

export type RetailReason = 'not_submitted' | 'zero_amount' | 'no_revenue_account' | 'closed_period'
export interface RetailResult {
  posted: boolean
  reason?: RetailReason
}

/**
 * Post a finalised store sale to the GL. `entryDate` should be the report/sale date.
 * Idempotent — safe to call again on the same sale.
 */
export async function postRetailSaleToGL(
  db: DB,
  sale: SaleRow,
  createdBy: string,
  entryDate: Date = new Date()
): Promise<RetailResult> {
  if (sale.status !== 'submitted') return { posted: false, reason: 'not_submitted' }
  const amount = Number(sale.totalAmount)
  if (!amount || amount <= 0) return { posted: false, reason: 'zero_amount' }

  let cashId: string
  let revenueId: string
  try {
    cashId = await resolveChannelAccountId(db, 'cash') // store sales are cash
    const revenue = await getAccountByCode(db, FINANCE_ACCOUNTS.RETAIL_REVENUE)
    if (!revenue) return { posted: false, reason: 'no_revenue_account' }
    revenueId = revenue.id
  } catch {
    // getAccountByCode throws when 4200 isn't seeded — surface it, don't crash submit.
    return { posted: false, reason: 'no_revenue_account' }
  }

  const money = Money.from(amount)
  // Never silently drop: a closed report month falls back to the current open period.
  const outcome = await postInOpenPeriod(
    db,
    {
      sourceDocType: 'retail_sale',
      sourceDocId: sale.id,
      description: 'Store sale',
      createdBy,
      lines: [
        { accountId: cashId, debit: money, description: 'Store sale (cash)' },
        { accountId: revenueId, credit: money, description: 'Retail sales revenue' },
      ],
    },
    entryDate
  )
  return outcome === 'posted' ? { posted: true } : { posted: false, reason: 'closed_period' }
}
