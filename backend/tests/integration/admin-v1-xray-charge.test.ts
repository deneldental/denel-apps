/**
 * admin-v1 X-ray auto-charge smoke tests (§9.6 + §9.7).
 *
 * Proves the X-ray auto-charge posts to the double-entry GL:
 *   - INTERNAL capture → a patient invoice (DR 1200 AR / CR 4100 revenue),
 *     priced from the `xray` Services catalog; an explicit override is honoured;
 *     `skipCharge` / an unpriced type are no-ops (non-blocking).
 *   - EXTERNAL capture → a direct receipt (DR 1000 Cash / CR 4100 revenue).
 *   - §9.7 `getXrayDailySummary` returns the internal/external split + revenue.
 *
 * Run with `doppler run -- pnpm --filter backend test admin-v1-xray-charge`
 * (gated on DATABASE_URL). Every test runs inside `withRollback` (always rolled
 * back; the shared dev DB is never mutated) and asserts the actual journal lines.
 */

import { randomUUID } from 'node:crypto'
import { Money } from '@denel/utils'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { DB } from '../../src/db'
import { invoices, journalEntries, services, xrayRecords, xrayTypes } from '../../src/db/schema'
import { getOrCreatePeriodFor } from '../../src/lib/period-service'
import { autoChargeXray, getXrayDailySummary } from '../../src/lib/xray-charge-service'
import { accountIdByCode, anyUserId, makePatient } from './_fixtures'
import { noDb, withRollback } from './_setup'

/** withRollback + an OPEN accounting period covering today (issue/post need one). */
async function withPostingRollback(fn: (tx: DB) => Promise<void>) {
  await withRollback(async (tx) => {
    await getOrCreatePeriodFor(tx, new Date())
    await fn(tx)
  })
}

// ── JE helpers (same shape as the walk-in / money-flow suites) ───────────────

type Line = { accountId: string; debit: number | null; credit: number | null }

async function liveEntry(tx: DB, sourceDocType: string, sourceDocId: string) {
  const e = await tx.query.journalEntries.findFirst({
    where: and(
      eq(journalEntries.sourceDocType, sourceDocType as never),
      eq(journalEntries.sourceDocId, sourceDocId),
      eq(journalEntries.isReversal, false)
    ),
    with: { lines: true },
  })
  if (!e) return null
  return { id: e.id, lines: (e as unknown as { lines: Line[] }).lines }
}

const sumDebit = (lines: Line[]) => lines.reduce((s, l) => s + Number(l.debit ?? 0), 0)
const sumCredit = (lines: Line[]) => lines.reduce((s, l) => s + Number(l.credit ?? 0), 0)
const debitOn = (lines: Line[], id: string) =>
  lines.filter((l) => l.accountId === id).reduce((s, l) => s + Number(l.debit ?? 0), 0)
const creditOn = (lines: Line[], id: string) =>
  lines.filter((l) => l.accountId === id).reduce((s, l) => s + Number(l.credit ?? 0), 0)
const expectBalanced = (lines: Line[]) =>
  expect(Money.from(sumDebit(lines)).eq(Money.from(sumCredit(lines)))).toBe(true)

// ── fixture builders ─────────────────────────────────────────────────────────

async function makeXrayType(tx: DB): Promise<string> {
  const [t] = await tx
    .insert(xrayTypes)
    .values({ name: `it-xt-${randomUUID().slice(0, 10)}`, displayName: 'IT Bitewing' })
    .returning()
  return t.id
}

/**
 * A priced `xray` catalog service pointing at the given xray type.
 * `amount` is CENTS (migration 0209) — 25000 is GHS 250.00.
 */
async function makeXrayService(
  tx: DB,
  opts: { userId: string; xrayTypeId: string; amount: number; taxStatus?: string }
): Promise<string> {
  const [svc] = await tx
    .insert(services)
    .values({
      category: 'xray',
      name: `IT X-ray ${randomUUID().slice(0, 6)}`,
      amount: opts.amount,
      xrayTypeId: opts.xrayTypeId,
      taxStatus: opts.taxStatus ?? 'exempt',
      status: 'active',
      createdById: opts.userId,
    })
    .returning()
  return svc.id
}

async function makeXrayRecord(
  tx: DB,
  opts: { patientId: string; xrayTypeId: string; origin: 'internal' | 'external'; userId: string }
) {
  const [r] = await tx
    .insert(xrayRecords)
    .values({
      patientId: opts.patientId,
      xrayTypeId: opts.xrayTypeId,
      origin: opts.origin,
      imageUrl: 'https://example.test/it-xray.png',
      uploadedById: opts.userId,
    })
    .returning()
  return r
}

const n = (v: unknown) => Money.from(v as never).toNumber()

// ── tests ────────────────────────────────────────────────────────────────────

describe.skipIf(noDb)('admin-v1 X-ray auto-charge (§9.6) → GL', () => {
  it('internal capture creates a patient invoice at the catalog price', async () => {
    await withPostingRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const xrayTypeId = await makeXrayType(tx)
      await makeXrayService(tx, { userId, xrayTypeId, amount: 25000 })
      const record = await makeXrayRecord(tx, {
        patientId,
        xrayTypeId,
        origin: 'internal',
        userId,
      })

      const res = await autoChargeXray(tx, { record, userId })

      expect(res.charged).toBe(true)
      expect(res.kind).toBe('invoice')
      expect(res.amount).toBe(25000) // cents; `n()` below reports the cedis view
      const invoiceId = res.invoiceId
      if (!invoiceId) throw new Error('expected an invoice id')

      const inv = await tx.query.invoices.findFirst({ where: eq(invoices.id, invoiceId) })
      expect(inv?.status).toBe('issued')
      expect(n(inv?.total)).toBe(250)
      expect(n(inv?.subtotal)).toBe(250)

      const rev = await accountIdByCode(tx, '4100') // imaging → Diagnostic revenue
      const ar = await accountIdByCode(tx, '1200')
      const je = await liveEntry(tx, 'invoice', invoiceId)
      if (!je) throw new Error('no invoice entry')
      expectBalanced(je.lines)
      expect(debitOn(je.lines, ar)).toBe(25000)
      expect(creditOn(je.lines, rev)).toBe(25000)
    })
  })

  it('an explicit override is charged instead of the catalog price', async () => {
    await withPostingRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const xrayTypeId = await makeXrayType(tx)
      await makeXrayService(tx, { userId, xrayTypeId, amount: 25000 })
      const record = await makeXrayRecord(tx, {
        patientId,
        xrayTypeId,
        origin: 'internal',
        userId,
      })

      const res = await autoChargeXray(tx, { record, userId, amountOverride: 8000 })

      expect(res.charged).toBe(true)
      expect(res.amount).toBe(8000)
      const invoiceId = res.invoiceId
      if (!invoiceId) throw new Error('expected an invoice id')
      const inv = await tx.query.invoices.findFirst({ where: eq(invoices.id, invoiceId) })
      expect(n(inv?.total)).toBe(80)

      const rev = await accountIdByCode(tx, '4100')
      const je = await liveEntry(tx, 'invoice', invoiceId)
      if (!je) throw new Error('no invoice entry')
      expect(creditOn(je.lines, rev)).toBe(8000)
    })
  })

  it('skipCharge is a no-op (capture is never blocked by billing)', async () => {
    await withPostingRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const xrayTypeId = await makeXrayType(tx)
      await makeXrayService(tx, { userId, xrayTypeId, amount: 25000 })
      const record = await makeXrayRecord(tx, {
        patientId,
        xrayTypeId,
        origin: 'internal',
        userId,
      })

      const res = await autoChargeXray(tx, { record, userId, skipCharge: true })
      expect(res.charged).toBe(false)
      expect(res.kind).toBe('skipped')
      expect(res.reason).toBe('skipped')
    })
  })

  it('an unpriced X-ray type is a no-op (no catalog price → no_price)', async () => {
    await withPostingRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const xrayTypeId = await makeXrayType(tx) // no service pointing at it
      const record = await makeXrayRecord(tx, {
        patientId,
        xrayTypeId,
        origin: 'internal',
        userId,
      })

      const res = await autoChargeXray(tx, { record, userId })
      expect(res.charged).toBe(false)
      expect(res.reason).toBe('no_price')
    })
  })

  it('external capture posts a direct receipt (DR 1000 cash / CR 4100 revenue)', async () => {
    await withPostingRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const xrayTypeId = await makeXrayType(tx)
      await makeXrayService(tx, { userId, xrayTypeId, amount: 12000 })
      const record = await makeXrayRecord(tx, {
        patientId,
        xrayTypeId,
        origin: 'external',
        userId,
      })

      const res = await autoChargeXray(tx, { record, userId })

      expect(res.charged).toBe(true)
      expect(res.kind).toBe('direct')
      expect(res.journalPosted).toBe(true)
      expect(res.amount).toBe(12000)

      // No invoice should be created for the external direct receipt.
      const inv = await tx.query.invoices.findFirst({
        where: eq(invoices.patientId, patientId),
      })
      expect(inv).toBeUndefined()

      // The direct receipt rides the `retail_sale` source type (no migration).
      const cash = await accountIdByCode(tx, '1000')
      const rev = await accountIdByCode(tx, '4100')
      const je = await tx.query.journalEntries.findFirst({
        where: and(
          eq(journalEntries.sourceDocType, 'retail_sale' as never),
          eq(journalEntries.isReversal, false)
        ),
        with: { lines: true },
      })
      const lines = (je as unknown as { lines: Line[] } | undefined)?.lines ?? []
      expectBalanced(lines)
      expect(debitOn(lines, cash)).toBe(12000)
      expect(creditOn(lines, rev)).toBe(12000)
    })
  })
})

describe.skipIf(noDb)('admin-v1 X-ray mini-report (§9.7)', () => {
  it('splits internal/external and reports catalog revenue', async () => {
    await withPostingRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const xrayTypeId = await makeXrayType(tx)
      await makeXrayService(tx, { userId, xrayTypeId, amount: 10000 })

      // Two internal + one external capture today, all priced at GHS 100.00.
      await makeXrayRecord(tx, { patientId, xrayTypeId, origin: 'internal', userId })
      await makeXrayRecord(tx, { patientId, xrayTypeId, origin: 'internal', userId })
      await makeXrayRecord(tx, { patientId, xrayTypeId, origin: 'external', userId })

      const summary = await getXrayDailySummary(tx, new Date())
      if (!summary) throw new Error('expected a summary')
      expect(summary.module).toBe('xrays')

      const metric = (label: string) => summary.metrics.find((m) => m.label === label)?.value
      expect(metric('Total')).toBe(3)
      expect(metric('Internal')).toBe(2)
      expect(metric('External')).toBe(1)
      // 3 × GHS 100.00 priced from the same catalog the auto-charge uses.
      expect(metric('Revenue')).toBe('GHS 300.00')
    })
  })
})
