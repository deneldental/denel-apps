/**
 * Remittances — admin-v1 §14.2 / F. Pay an accumulated statutory payable to
 * government; clears that payable in the GL (DR payable / CR bank). Admin-only.
 */

import { Money } from '@denel/utils'
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { accounts, journalLines, remittances } from '../db/schema'
import { getAccountByCode, resolveChannelAccountId } from '../lib/channel-accounts'
import { FINANCE_ACCOUNTS } from '../lib/finance-accounts'
import { postInOpenPeriod } from '../lib/gl-service'
import { logError } from '../lib/logger'
import { getCurrentUser, isAdmin } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

export const remittancesApp = new Hono<HonoEnv>()

// `code` is sourced from the central CoA map so a renumber stays in sync; `name`
// is the user-facing label persisted to remittances.payableName (left verbatim).
const PAYABLES: Array<{ code: string; name: string }> = [
  { code: FINANCE_ACCOUNTS.TAX_PAYABLE, name: 'VAT Payable' },
  { code: FINANCE_ACCOUNTS.NHIL_GETFUND_PAYABLE, name: 'NHIL/GETFund Payable' },
  { code: FINANCE_ACCOUNTS.WHT_PAYABLE, name: 'Withholding Tax Payable' },
  { code: FINANCE_ACCOUNTS.PAYE_PAYABLE, name: 'PAYE Payable' },
  { code: FINANCE_ACCOUNTS.SSNIT_PAYABLE, name: 'SSNIT Payable' },
]
const PAYABLE_CODES = PAYABLES.map((p) => p.code)

// GET /payables — current balance of each remittable payable (what's owed today).
remittancesApp.get('/payables', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await isAdmin(c, user.id))) return c.json({ error: 'Admin only' }, 403)
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const accts = await db
      .select({ id: accounts.id, code: accounts.code })
      .from(accounts)
      .where(inArray(accounts.code, PAYABLE_CODES))
    const idToCode = new Map(accts.map((a) => [a.id, a.code]))
    const sums = accts.length
      ? await db
          .select({
            accountId: journalLines.accountId,
            bal: sql<number>`coalesce(sum(${journalLines.credit} - ${journalLines.debit}), 0)`,
          })
          .from(journalLines)
          .where(
            inArray(
              journalLines.accountId,
              accts.map((a) => a.id)
            )
          )
          .groupBy(journalLines.accountId)
      : []
    const codeToBal = new Map<string, number>()
    for (const s of sums) {
      const code = idToCode.get(s.accountId)
      if (code) codeToBal.set(code, Number(s.bal))
    }
    return c.json({
      success: true,
      data: PAYABLES.map((p) => ({
        code: p.code,
        name: p.name,
        balance: codeToBal.get(p.code) ?? 0,
      })),
    })
  } catch (error: unknown) {
    logError(error, { context: '[remittances] payables' })
    return c.json({ error: 'Failed to fetch payables' }, 500)
  }
})

// GET / — past remittances
remittancesApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await isAdmin(c, user.id))) return c.json({ error: 'Admin only' }, 403)
  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db.select().from(remittances).orderBy(desc(remittances.paidAt)).limit(200)
  return c.json({ success: true, data: rows })
})

// POST / — record a remittance + post DR payable / CR bank
remittancesApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await isAdmin(c, user.id))) return c.json({ error: 'Admin only' }, 403)

  const body = (await c.req.json().catch(() => ({}))) as {
    payableCode?: string
    amount?: number
    reference?: string
  }
  const payable = PAYABLES.find((p) => p.code === body.payableCode)
  if (!payable) return c.json({ error: 'Invalid payable account' }, 400)
  const amount = Number(body.amount)
  if (!amount || amount <= 0) return c.json({ error: 'amount must be > 0' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    let payableId: string | null = null
    let bankId: string | null = null
    try {
      payableId = (await getAccountByCode(db, payable.code))?.id ?? null
      bankId = await resolveChannelAccountId(db, 'bank_transfer')
    } catch {
      /* fall through to the seeded-account check */
    }
    if (!payableId || !bankId) return c.json({ error: 'Required GL account is not seeded' }, 400)

    // Dedup guard: a remittance has no natural idempotency key (each is a distinct
    // payment), so a double-click / client retry would post twice and clear the
    // payable + credit the bank twice. Reject an identical remittance recorded in
    // the last 2 minutes.
    const recent = await db
      .select({ id: remittances.id })
      .from(remittances)
      .where(
        and(
          eq(remittances.payableCode, payable.code),
          eq(remittances.amount, amount),
          body.reference
            ? eq(remittances.reference, body.reference)
            : isNull(remittances.reference),
          gte(remittances.paidAt, new Date(Date.now() - 120_000))
        )
      )
      .limit(1)
    if (recent.length > 0) {
      return c.json(
        { error: 'An identical remittance was just recorded. Refresh to confirm before retrying.' },
        409
      )
    }

    // Insert the row + post the GL in ONE transaction — an unposted GL (closed
    // period) must not leave an orphan remittance row with no offsetting entry.
    const money = Money.from(amount)
    const { row, posted } = await db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as typeof db
      const [r] = await tx
        .insert(remittances)
        .values({
          payableCode: payable.code,
          payableName: payable.name,
          amount,
          reference: body.reference ?? null,
          createdById: user.id,
        })
        .returning()
      const outcome = await postInOpenPeriod(
        tx,
        {
          sourceDocType: 'remittance',
          sourceDocId: r.id,
          description: `Remittance: ${payable.name}${body.reference ? ` (${body.reference})` : ''}`,
          createdBy: user.id,
          lines: [
            { accountId: payableId, debit: money, description: `Remit ${payable.name}` },
            { accountId: bankId, credit: money, description: 'Paid to government' },
          ],
        },
        new Date()
      )
      if (outcome !== 'posted') throw new Error('REMITTANCE_UNPOSTED')
      return { row: r, posted: true }
    })
    return c.json({ success: true, data: row, glPosted: posted })
  } catch (error: unknown) {
    const msg = String((error as Error)?.message ?? error)
    if (msg.includes('REMITTANCE_UNPOSTED')) {
      return c.json(
        { error: 'Could not post the remittance (the period may be closed). Nothing was saved.' },
        409
      )
    }
    logError(error, { context: '[remittances] post' })
    return c.json({ error: 'Failed to record remittance' }, 500)
  }
})
