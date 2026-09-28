/**
 * The petty-cash box balance (settings-domain-audit S5-B): the latest
 * replenishment's amount minus petty disbursements since its date; with no
 * replenishment yet, the policy's default float from the start of the current
 * month. Flagged disbursements are excluded (they are disputed, not spent).
 */

import { cedisToPesewas, computePettyBalance, type PettyCashPolicy } from '@denel/utils'
import { and, desc, eq, gte, isNull, ne, or, sql } from 'drizzle-orm'
import type { DB } from '../db'
import { expenseCategories, expenses, pettyCashReplenishments } from '../db/schema'
import { getPettyCashPolicy } from './settings-store'

export interface PettyCashBalance {
  source: 'replenishment' | 'default'
  /** Pesewas. */
  floatAmount: number
  since: Date
  /** Pesewas. */
  spentSince: number
  /** Pesewas. */
  balance: number
  /** Pesewas. */
  warningThreshold: number
  belowWarning: boolean
  /** Pesewas. */
  approvalLimit: number
  maxActiveIousPerStaff: number
  lastReplenishment: { id: string; date: Date; amount: number; note: string | null } | null
}

function startOfMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

export async function getPettyCashBalance(
  db: DB,
  policyOverride?: PettyCashPolicy,
  now: Date = new Date()
): Promise<PettyCashBalance> {
  const policy = policyOverride ?? (await getPettyCashPolicy(db))
  const [last] = await db
    .select({
      id: pettyCashReplenishments.id,
      date: pettyCashReplenishments.date,
      amount: pettyCashReplenishments.amount,
      note: pettyCashReplenishments.note,
    })
    .from(pettyCashReplenishments)
    .orderBy(desc(pettyCashReplenishments.date), desc(pettyCashReplenishments.createdAt))
    .limit(1)

  const since = last ? last.date : startOfMonth(now)
  const floatAmount = last ? last.amount : cedisToPesewas(policy.defaultFloat)

  const [spent] = await db
    .select({ total: sql<number>`COALESCE(SUM(${expenses.amount}), 0)::int` })
    .from(expenses)
    .innerJoin(expenseCategories, eq(expenses.category, expenseCategories.name))
    .where(
      and(
        eq(expenseCategories.isPettyCash, true),
        gte(expenses.date, since),
        or(isNull(expenses.confirmationStatus), ne(expenses.confirmationStatus, 'flagged'))
      )
    )
  const spentSince = Number(spent?.total ?? 0)
  const { balance, warningPesewas, belowWarning } = computePettyBalance({
    floatPesewas: floatAmount,
    spentSincePesewas: spentSince,
    warningCedis: policy.replenishWarningThreshold,
  })

  return {
    source: last ? 'replenishment' : 'default',
    floatAmount,
    since,
    spentSince,
    balance,
    warningThreshold: warningPesewas,
    belowWarning,
    approvalLimit: cedisToPesewas(policy.singleApprovalLimit),
    maxActiveIousPerStaff: policy.maxActiveIousPerStaff,
    lastReplenishment: last ?? null,
  }
}
