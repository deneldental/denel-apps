/**
 * admin-v1 Labs §8.3 + §8.6 smoke tests.
 *
 * §8.3 — the lab-case status lookup (migration 0120, seeded with the canonical 8):
 *         ordered by sortOrder, active-only by default.
 * §8.6 — the Labs daily summary aggregator (getLabDailySummary / getLabDayMetrics):
 *         cases-by-status, patient lab revenue (payments toward lab-case invoices),
 *         and lab_work + lab-inventory expenses, shaped as a §10.1 ModuleSummary.
 *
 * vitest + withRollback sandbox against the dev DB
 * (`doppler run -- pnpm --filter backend test admin-v1-labs-gl`; plain `pnpm test`
 * skips). Far-future dates + unique names isolate each case from real rows.
 */

import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { DB } from '../../src/db'
import {
  expenses,
  invoices,
  labCaseStatuses,
  labCases,
  labVendors,
  paymentAllocations,
  payments,
} from '../../src/db/schema'
import { getLabDailySummary, getLabDayMetrics } from '../../src/lib/lab-summary'
import { anyUserId, makePatient, uniqueDocNumber } from './_fixtures'
import { noDb, withRollback } from './_setup'

async function makeVendor(tx: DB): Promise<string> {
  const [v] = await tx
    .insert(labVendors)
    .values({ name: `IT Vendor ${randomUUID().slice(0, 8)}`, type: 'external' })
    .returning()
  return v.id
}

const metric = (
  block: { metrics: { label: string; value: string | number }[] } | null,
  label: string
) => block?.metrics.find((m) => m.label === label)?.value

// ── §8.3 — lab-case status lookup ─────────────────────────────────────────────

describe.skipIf(noDb)('admin-v1 §8.3 — lab-case status lookup', () => {
  it('returns the seeded statuses ordered by sortOrder', async () => {
    await withRollback(async (tx) => {
      const rows = await tx
        .select()
        .from(labCaseStatuses)
        .where(eq(labCaseStatuses.isActive, true))
        .orderBy(asc(labCaseStatuses.sortOrder), asc(labCaseStatuses.displayName))

      // The canonical 8 are seeded by migration 0120.
      const names = rows.map((r) => r.name)
      for (const expected of [
        'draft',
        'sent',
        'in_progress',
        'delayed',
        'received',
        'ready_for_insertion',
        'inserted',
        'cancelled',
      ]) {
        expect(names).toContain(expected)
      }

      // Strictly non-decreasing sortOrder (the lookup's contract for the FE).
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].sortOrder).toBeGreaterThanOrEqual(rows[i - 1].sortOrder)
      }

      // draft (10) sorts before cancelled (70).
      const draftIdx = names.indexOf('draft')
      const cancelledIdx = names.indexOf('cancelled')
      expect(draftIdx).toBeLessThan(cancelledIdx)
    })
  })

  it('a custom (admin-added) status slots in by its sortOrder and is active', async () => {
    await withRollback(async (tx) => {
      const customName = `it_custom_${randomUUID().slice(0, 8)}`
      await tx.insert(labCaseStatuses).values({
        name: customName,
        displayName: 'IT Custom',
        // Migration 0165 reordered the workflow: received (40), ready (50),
        // delayed (60), cancelled (70), inserted (80). 45 slots between the
        // first two.
        sortOrder: 45,
        color: 'secondary',
      })
      const rows = await tx
        .select()
        .from(labCaseStatuses)
        .where(eq(labCaseStatuses.isActive, true))
        .orderBy(asc(labCaseStatuses.sortOrder), asc(labCaseStatuses.displayName))
      const names = rows.map((r) => r.name)
      const idx = names.indexOf(customName)
      expect(idx).toBeGreaterThan(names.indexOf('received'))
      expect(idx).toBeLessThan(names.indexOf('ready_for_insertion'))
      expect(rows[idx].isActive).toBe(true)
    })
  })
})

// ── §8.6 — Labs daily summary aggregator ──────────────────────────────────────

describe.skipIf(noDb)('admin-v1 §8.6 — labs daily summary', () => {
  it('returns null on a quiet day (no cases, revenue, or expenses)', async () => {
    await withRollback(async (tx) => {
      const quiet = new Date('2099-02-01T10:00:00.000Z')
      const block = await getLabDailySummary(tx, quiet)
      expect(block).toBeNull()
    })
  })

  it('counts cases by status for the day', async () => {
    await withRollback(async (tx) => {
      const day = new Date('2099-07-01T10:00:00.000Z')
      const pid = await makePatient(tx, 'IT Lab Summary Cases')
      const vendorId = await makeVendor(tx)
      // 2 draft + 1 sent, all opened on `day`.
      for (const status of ['draft', 'draft', 'sent']) {
        await tx.insert(labCases).values({
          caseNumber: `LC-${randomUUID().slice(0, 8)}`,
          serviceName: 'IT Crown',
          patientId: pid,
          vendorId,
          status,
          domain: 'internal',
          createdAt: day,
        })
      }
      const m = await getLabDayMetrics(tx, day)
      expect(m.totalCases).toBe(3)
      expect(m.casesByStatus.draft).toBe(2)
      expect(m.casesByStatus.sent).toBe(1)

      const block = await getLabDailySummary(tx, day)
      expect(block?.module).toBe('labs')
      expect(metric(block, 'New cases')).toBe(3)
    })
  })

  it('sums patient lab revenue from payments allocated to lab-case invoices', async () => {
    await withRollback(async (tx) => {
      const day = new Date('2099-07-02T10:00:00.000Z')
      const userId = await anyUserId(tx)
      const pid = await makePatient(tx, 'IT Lab Revenue')
      const vendorId = await makeVendor(tx)

      // An invoice linked to a lab case.
      const [inv] = await tx
        .insert(invoices)
        .values({
          invoiceNumber: uniqueDocNumber('INV'),
          patientId: pid,
          type: 'one_time',
          status: 'issued',
          amount: 50000, // cents (0209) — GHS 500.00
          paidAmount: 0,
        })
        .returning()
      await tx.insert(labCases).values({
        caseNumber: `LC-${randomUUID().slice(0, 8)}`,
        serviceName: 'IT Crown',
        patientId: pid,
        vendorId,
        status: 'sent',
        domain: 'internal',
        invoiceId: inv.id,
        createdAt: day,
      })

      // A posted incoming payment dated today, allocated to that invoice.
      const [pay] = await tx
        .insert(payments)
        .values({
          patientId: pid,
          invoiceId: inv.id,
          amount: 30000,
          method: 'cash',
          status: 'posted',
          direction: 'incoming',
          // allocated + unallocated must reconcile to amount (payments_amount_split_check).
          allocatedAmount: 30000,
          unallocatedAmount: 0,
          createdAt: day,
        })
        .returning()
      await tx.insert(paymentAllocations).values({
        paymentId: pay.id,
        targetType: 'invoice',
        targetId: inv.id,
        amount: 30000,
        allocatedBy: userId,
      })

      const m = await getLabDayMetrics(tx, day)
      expect(m.labRevenue).toBe(30000) // cents; the metric below is the cedis view

      const block = await getLabDailySummary(tx, day)
      expect(metric(block, 'Lab revenue')).toBe('GHS 300.00')
    })
  })

  it('falls back to a legacy direct-invoiceId payment when no allocation exists', async () => {
    await withRollback(async (tx) => {
      const day = new Date('2099-07-03T10:00:00.000Z')
      const pid = await makePatient(tx, 'IT Lab Legacy Rev')
      const vendorId = await makeVendor(tx)
      const [inv] = await tx
        .insert(invoices)
        .values({
          invoiceNumber: uniqueDocNumber('INV'),
          patientId: pid,
          type: 'one_time',
          status: 'issued',
          amount: 12000,
          paidAmount: 0,
        })
        .returning()
      await tx.insert(labCases).values({
        caseNumber: `LC-${randomUUID().slice(0, 8)}`,
        serviceName: 'IT Bridge',
        patientId: pid,
        vendorId,
        status: 'sent',
        domain: 'internal',
        invoiceId: inv.id,
        createdAt: day,
      })
      // Payment with the legacy direct invoiceId, NO allocation row.
      await tx.insert(payments).values({
        patientId: pid,
        invoiceId: inv.id,
        amount: 12000,
        method: 'cash',
        status: 'posted',
        direction: 'incoming',
        allocatedAmount: 12000,
        unallocatedAmount: 0,
        createdAt: day,
      })
      const m = await getLabDayMetrics(tx, day)
      expect(m.labRevenue).toBe(12000)
    })
  })

  it('sums lab_work and lab-inventory expenses recorded that day', async () => {
    await withRollback(async (tx) => {
      const day = new Date('2099-07-04T10:00:00.000Z')
      const userId = await anyUserId(tx)
      await tx.insert(expenses).values([
        {
          category: 'lab_work',
          amount: 8000,
          status: 'paid',
          paymentMethod: 'cash',
          date: day,
          createdById: userId,
        },
        {
          category: 'lab-inventory',
          amount: 4500,
          status: 'paid',
          paymentMethod: 'cash',
          date: day,
          createdById: userId,
        },
        // a non-lab expense on the same day must be ignored
        {
          category: 'utilities',
          amount: 99900,
          status: 'paid',
          paymentMethod: 'cash',
          date: day,
          createdById: userId,
        },
      ])
      const m = await getLabDayMetrics(tx, day)
      expect(m.labProviderExpense).toBe(8000)
      expect(m.labInventoryExpense).toBe(4500)

      const block = await getLabDailySummary(tx, day)
      expect(metric(block, 'Provider expense')).toBe('GHS 80.00')
      expect(metric(block, 'Lab inventory expense')).toBe('GHS 45.00')
      expect(metric(block, 'Total lab expense')).toBe('GHS 125.00')
    })
  })
})
