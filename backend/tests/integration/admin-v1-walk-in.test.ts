/**
 * admin-v1 walk-in smoke tests — the verification gate for the Scheduling
 * walk-in flow (`createWalkIn`): one transactional encounter that creates an
 * appointment, bills the chosen catalog services, and takes payment, all
 * posting to the double-entry GL.
 *
 * Run with `doppler run -- pnpm --filter backend test` (gated on DATABASE_URL).
 * Every test runs inside `withRollback` (always rolled back; the shared dev DB
 * is never mutated) and asserts the actual journal lines — proving the books.
 */

import { randomUUID } from 'node:crypto'
import { Money } from '@denel/utils'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { DB } from '../../src/db'
import {
  applicationScopes,
  doctors,
  invoices,
  journalEntries,
  patientWallets,
  services,
  treatmentTypes,
} from '../../src/db/schema'
import { getOrCreatePeriodFor } from '../../src/lib/period-service'
import { createWalkIn } from '../../src/lib/walk-in-service'
import { accountIdByCode, anyUserId, makePatient, makeSpecialist } from './_fixtures'
import { expectRejection, noDb, withRollback } from './_setup'

/** withRollback + an OPEN accounting period covering today (issue/post need one). */
async function withPostingRollback(fn: (tx: DB) => Promise<void>) {
  await withRollback(async (tx) => {
    await getOrCreatePeriodFor(tx, new Date())
    await fn(tx)
  })
}

// ── JE helpers (same shape as the money-flow suite) ──────────────────────────

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

/** A `doctors` row sourced from a specialist (satisfies the source-XOR check). */
async function makeDoctor(tx: DB, specialistId: string): Promise<string> {
  const [d] = await tx
    .insert(doctors)
    .values({ specialistId, specialty: 'IT Dentistry' })
    .returning()
  return d.id
}

/**
 * A priced catalog service under a treatment type carrying an ADA group.
 * `amount` is CENTS (migration 0209) — 30000 is GHS 300.00.
 */
async function makeService(
  tx: DB,
  opts: {
    userId: string
    amount: number
    adaGroup: string
    taxStatus?: string
    discountEligible?: boolean
    /** G01: the application type the service bills against, and its further-unit price. */
    scopeId?: string | null
    additionalUnitPrice?: number | null
  }
): Promise<string> {
  const [tt] = await tx
    .insert(treatmentTypes)
    .values({ name: `it-${randomUUID().slice(0, 10)}`, adaGroup: opts.adaGroup })
    .returning()
  const [svc] = await tx
    .insert(services)
    .values({
      category: 'clinic',
      name: `IT Service ${randomUUID().slice(0, 6)}`,
      amount: opts.amount,
      treatmentTypeId: tt.id,
      taxStatus: opts.taxStatus ?? 'exempt',
      discountEligible: opts.discountEligible ?? true,
      scopeId: opts.scopeId ?? null,
      additionalUnitPrice: opts.additionalUnitPrice ?? null,
      status: 'active',
      createdById: opts.userId,
    })
    .returning()
  return svc.id
}

/** G01: a type billed per unit; `stepped` is its first-unit / additional-unit toggle. */
async function makeMultiScope(tx: DB, stepped: boolean): Promise<string> {
  const [row] = await tx
    .insert(applicationScopes)
    .values({
      name: `it_walkin_${randomUUID().slice(0, 8)}`,
      displayName: 'IT walk-in type',
      quantityMode: 'multi',
      additionalUnitPriceEnabled: stepped,
    })
    .returning({ id: applicationScopes.id })
  return row.id
}

const n = (v: unknown) => Money.from(v as never).toNumber()

// ── tests ────────────────────────────────────────────────────────────────────

describe.skipIf(noDb)('admin-v1 walk-in — catalog-priced encounter → GL', () => {
  it('full cash payment: appointment checked-in, invoice paid, books balanced', async () => {
    await withPostingRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const specId = await makeSpecialist(tx, { commissionRate: 10 })
      const doctorId = await makeDoctor(tx, specId)
      const serviceId = await makeService(tx, { userId, amount: 30000, adaGroup: 'Restorative' })

      const res = await createWalkIn(
        tx,
        {
          patientId,
          appointment: { doctorId },
          lines: [{ serviceId }],
          payment: { method: 'cash', amount: 30000 },
        },
        userId
      )

      // Encounter + invoice state.
      expect(res.appointment.status).toBe('checked_in')
      expect(res.appointment.checkedInAt).toBeTruthy()
      expect(res.invoice.status).toBe('paid')
      expect(n(res.invoice.total)).toBe(300)
      expect(n(res.invoice.balance)).toBe(0)
      expect(res.payment).not.toBeNull()

      const rev = await accountIdByCode(tx, '4120') // Restorative → 4120
      const ar = await accountIdByCode(tx, '1200')
      const cash = await accountIdByCode(tx, '1000')

      const inv = await liveEntry(tx, 'invoice', res.invoice.id)
      if (!inv) throw new Error('no invoice entry')
      expectBalanced(inv.lines)
      // `n()` reports cedis; the raw journal lines are cents.
      expect(creditOn(inv.lines, rev)).toBe(30000)
      expect(debitOn(inv.lines, ar)).toBe(30000)

      const payment = res.payment
      if (!payment) throw new Error('expected a posted payment')
      const pay = await liveEntry(tx, 'payment', payment.id)
      if (!pay) throw new Error('no payment entry')
      expectBalanced(pay.lines)
      expect(debitOn(pay.lines, cash)).toBe(30000)
      expect(creditOn(pay.lines, ar)).toBe(30000)

      // AR nets to zero across issue + payment.
      expect(debitOn(inv.lines, ar) - creditOn(pay.lines, ar)).toBe(0)
    })
  })

  it('partial payment leaves the invoice partially paid with a balance', async () => {
    await withPostingRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const specId = await makeSpecialist(tx)
      const doctorId = await makeDoctor(tx, specId)
      const serviceId = await makeService(tx, { userId, amount: 30000, adaGroup: 'Preventive' })

      const res = await createWalkIn(
        tx,
        {
          patientId,
          appointment: { doctorId },
          lines: [{ serviceId }],
          payment: { method: 'cash', amount: 10000 },
        },
        userId
      )

      expect(res.invoice.status).toBe('partially_paid')
      expect(n(res.invoice.balance)).toBe(200)

      const cash = await accountIdByCode(tx, '1000')
      const ar = await accountIdByCode(tx, '1200')
      const payment = res.payment
      if (!payment) throw new Error('expected a posted payment')
      const pay = await liveEntry(tx, 'payment', payment.id)
      if (!pay) throw new Error('no payment entry')
      expectBalanced(pay.lines)
      expect(debitOn(pay.lines, cash)).toBe(10000)
      expect(creditOn(pay.lines, ar)).toBe(10000)
    })
  })

  it('overpayment posts the remainder to the patient wallet (2200)', async () => {
    await withPostingRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const specId = await makeSpecialist(tx)
      const doctorId = await makeDoctor(tx, specId)
      const serviceId = await makeService(tx, { userId, amount: 10000, adaGroup: 'Diagnostic' })

      const res = await createWalkIn(
        tx,
        {
          patientId,
          appointment: { doctorId },
          lines: [{ serviceId }],
          payment: { method: 'cash', amount: 15000 },
        },
        userId
      )

      expect(res.invoice.status).toBe('paid')
      expect(n(res.invoice.balance)).toBe(0)

      const cash = await accountIdByCode(tx, '1000')
      const ar = await accountIdByCode(tx, '1200')
      const deposits = await accountIdByCode(tx, '2200')
      const payment = res.payment
      if (!payment) throw new Error('expected a posted payment')
      const pay = await liveEntry(tx, 'payment', payment.id)
      if (!pay) throw new Error('no payment entry')
      expectBalanced(pay.lines)
      expect(debitOn(pay.lines, cash)).toBe(15000)
      expect(creditOn(pay.lines, ar)).toBe(10000)
      expect(creditOn(pay.lines, deposits)).toBe(5000)

      const wallet = await tx.query.patientWallets.findFirst({
        where: eq(patientWallets.patientId, patientId),
      })
      expect(n(wallet?.creditBalance ?? 0)).toBe(50)
    })
  })

  it('a standard-rated service carries Ghana output tax to 2300', async () => {
    await withPostingRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const specId = await makeSpecialist(tx)
      const doctorId = await makeDoctor(tx, specId)
      const serviceId = await makeService(tx, {
        userId,
        amount: 10000,
        adaGroup: 'Preventive',
        taxStatus: 'standard',
      })

      // Bill now, collect later — issue only, so we can assert the tax split
      // without first knowing the tax-inclusive total.
      const res = await createWalkIn(
        tx,
        { patientId, appointment: { doctorId }, lines: [{ serviceId }] },
        userId
      )

      expect(res.invoice.status).toBe('issued')
      expect(res.payment).toBeNull()
      expect(n(res.invoice.subtotal)).toBe(100)
      // Compared in cents so the total never rides on float division.
      const taxCents = Number(res.invoice.taxTotal)
      expect(taxCents).toBeGreaterThan(0)
      expect(Number(res.invoice.total)).toBe(10000 + taxCents)

      const rev = await accountIdByCode(tx, '4110') // Preventive → 4110
      const taxAcct = await accountIdByCode(tx, '2300')
      const inv = await liveEntry(tx, 'invoice', res.invoice.id)
      if (!inv) throw new Error('no invoice entry')
      expectBalanced(inv.lines)
      expect(creditOn(inv.lines, rev)).toBe(10000)
      expect(creditOn(inv.lines, taxAcct)).toBe(taxCents)
    })
  })

  it('a specialist line accrues commission (DR 5110 / CR 2100) at issue', async () => {
    await withPostingRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const specId = await makeSpecialist(tx, { commissionRate: 10 })
      const doctorId = await makeDoctor(tx, specId)
      const serviceId = await makeService(tx, { userId, amount: 20000, adaGroup: 'Endodontics' })

      const res = await createWalkIn(
        tx,
        {
          patientId,
          appointment: { doctorId },
          lines: [{ serviceId, specialistId: specId }],
        },
        userId
      )

      const commExpense = await accountIdByCode(tx, '5110')
      const commPayable = await accountIdByCode(tx, '2100')
      const inv = await liveEntry(tx, 'invoice', res.invoice.id)
      if (!inv) throw new Error('no invoice entry')
      expectBalanced(inv.lines)
      // 10% of the GHS 200.00 line.
      expect(debitOn(inv.lines, commExpense)).toBe(2000)
      expect(creditOn(inv.lines, commPayable)).toBe(2000)
    })
  })

  it('rejects a discount on a non-discount-eligible service', async () => {
    await expectRejection(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const specId = await makeSpecialist(tx)
      const doctorId = await makeDoctor(tx, specId)
      const serviceId = await makeService(tx, {
        userId,
        amount: 100,
        adaGroup: 'Preventive',
        discountEligible: false,
      })
      await createWalkIn(
        tx,
        {
          patientId,
          appointment: { doctorId },
          lines: [{ serviceId, discount: { type: 'percent', value: 10 } }],
        },
        userId
      )
    }, /discount-eligible/)
  })
})

// G01 — first-unit / additional-unit tariff, carried through the ledger. A service of a type
// billed in steps costs its price for the first unit and its additional-unit price for each
// further one; with the type's toggle off it is billed flat, as it always was.
describe.skipIf(noDb)('admin-v1 walk-in — first-unit / additional-unit tariff → GL', () => {
  /** A walk-in of three units of a 100.00 service whose further units cost 60.00 each. */
  async function walkInThreeUnits(tx: DB, stepped: boolean, payment?: number) {
    const userId = await anyUserId(tx)
    const patientId = await makePatient(tx)
    const specId = await makeSpecialist(tx)
    const doctorId = await makeDoctor(tx, specId)
    const scopeId = await makeMultiScope(tx, stepped)
    const serviceId = await makeService(tx, {
      userId,
      amount: 10000,
      adaGroup: 'Restorative',
      scopeId,
      additionalUnitPrice: 6000,
    })
    const res = await createWalkIn(
      tx,
      {
        patientId,
        appointment: { doctorId },
        lines: [{ serviceId, quantity: 3 }],
        ...(payment ? { payment: { method: 'cash', amount: payment } } : {}),
      },
      userId
    )
    return { res, scopeId, userId, patientId, doctorId, serviceId }
  }

  it('toggle on: bills 100 + 2 × 60 and books exactly that', async () => {
    await withPostingRollback(async (tx) => {
      const { res } = await walkInThreeUnits(tx, true, 22000)

      expect(n(res.invoice.total)).toBe(220)
      expect(res.invoice.status).toBe('paid')
      const rev = await accountIdByCode(tx, '4120') // Restorative → 4120
      const ar = await accountIdByCode(tx, '1200')
      const inv = await liveEntry(tx, 'invoice', res.invoice.id)
      if (!inv) throw new Error('no invoice entry')
      expectBalanced(inv.lines)
      expect(creditOn(inv.lines, rev)).toBe(22000)
      expect(debitOn(inv.lines, ar)).toBe(22000)
    })
  })

  it('toggle off: bills 3 × 100 and books exactly that', async () => {
    await withPostingRollback(async (tx) => {
      const { res } = await walkInThreeUnits(tx, false, 30000)

      expect(n(res.invoice.total)).toBe(300)
      expect(res.invoice.status).toBe('paid')
      const rev = await accountIdByCode(tx, '4120')
      const inv = await liveEntry(tx, 'invoice', res.invoice.id)
      if (!inv) throw new Error('no invoice entry')
      expectBalanced(inv.lines)
      expect(creditOn(inv.lines, rev)).toBe(30000)
    })
  })

  it('an invoice raised before the toggle was switched on keeps its total and its entry', async () => {
    await withPostingRollback(async (tx) => {
      const { res, scopeId, userId, patientId, serviceId } = await walkInThreeUnits(tx, false)
      expect(n(res.invoice.total)).toBe(300)

      await tx
        .update(applicationScopes)
        .set({ additionalUnitPriceEnabled: true })
        .where(eq(applicationScopes.id, scopeId))

      // The invoice already raised is stored as it was, and its ledger entry with it.
      const [stored] = await tx.select().from(invoices).where(eq(invoices.id, res.invoice.id))
      expect(n(stored.total)).toBe(300)
      const rev = await accountIdByCode(tx, '4120')
      const inv = await liveEntry(tx, 'invoice', res.invoice.id)
      if (!inv) throw new Error('no invoice entry')
      expect(creditOn(inv.lines, rev)).toBe(30000)

      // The next one is priced by the new rule. (Another doctor: the first is booked for now.)
      const otherDoctorId = await makeDoctor(tx, await makeSpecialist(tx))
      const next = await createWalkIn(
        tx,
        {
          patientId,
          appointment: { doctorId: otherDoctorId },
          lines: [{ serviceId, quantity: 3 }],
        },
        userId
      )
      expect(n(next.invoice.total)).toBe(220)
    })
  })

  it('one unit is billed at the first-unit price alone, with the toggle on', async () => {
    await withPostingRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const specId = await makeSpecialist(tx)
      const doctorId = await makeDoctor(tx, specId)
      const scopeId = await makeMultiScope(tx, true)
      const serviceId = await makeService(tx, {
        userId,
        amount: 10000,
        adaGroup: 'Restorative',
        scopeId,
        additionalUnitPrice: 6000,
      })

      const res = await createWalkIn(
        tx,
        { patientId, appointment: { doctorId }, lines: [{ serviceId, quantity: 1 }] },
        userId
      )

      expect(n(res.invoice.total)).toBe(100)
    })
  })
})
