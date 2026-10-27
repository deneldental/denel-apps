/**
 * G01 — first-unit / additional-unit tariff.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (G01) and step-10-handover.md.
 *
 * A service whose application type is billed in steps costs `unitPrice` for the first unit and
 * `additionalUnitPrice` for each further one, whichever variant is chosen. The type must have the
 * toggle on AND the service must have the additional price; without both it is billed flat, as it
 * always was. The price is worked out on the server (`resolveServicePrice` → `computeLine`), so an
 * estimate carries it; and an invoice already raised is never recomputed when the toggle moves.
 *
 * Every test runs inside `withRollback`: nothing is committed.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/service-stepped-pricing.test.ts
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { DB } from '../../src/db'
import {
  applicationScopes,
  invoiceLines,
  invoices,
  servicePrices,
  services,
  treatmentTypes,
} from '../../src/db/schema'
import { createEstimateDraft } from '../../src/lib/estimate-service'
import { resolveServicePrice } from '../../src/lib/service-pricing'
import { anyUserId, makePatient } from './_fixtures'
import { noDb, withRollback } from './_setup'

/** An application type; `stepped` is the toggle under test. */
async function makeScope(
  tx: DB,
  opts: { multi?: boolean; max?: number | null; stepped: boolean }
): Promise<string> {
  const [row] = await tx
    .insert(applicationScopes)
    .values({
      name: `it_g01_${randomUUID().slice(0, 8)}`,
      displayName: 'IT G01 type',
      quantityMode: opts.multi === false ? 'single' : 'multi',
      maxQuantity: opts.max ?? null,
      additionalUnitPriceEnabled: opts.stepped,
    })
    .returning({ id: applicationScopes.id })
  return row.id
}

/** A catalog service of the type, 100.00 for the first unit, with `additionalUnitPrice` after. */
async function makeService(
  tx: DB,
  opts: {
    userId: string
    scopeId: string | null
    amount?: number
    additionalUnitPrice?: number | null
    cells?: Array<{ variantName: string; price: number }>
  }
): Promise<string> {
  const [tt] = await tx
    .insert(treatmentTypes)
    .values({ name: `it-g01-${randomUUID().slice(0, 10)}`, adaGroup: 'Restorative' })
    .returning({ id: treatmentTypes.id })
  const [svc] = await tx
    .insert(services)
    .values({
      category: 'clinic',
      name: `IT G01 ${randomUUID().slice(0, 6)}`,
      amount: opts.amount ?? 10000,
      treatmentTypeId: tt.id,
      scopeId: opts.scopeId,
      additionalUnitPrice: opts.additionalUnitPrice ?? null,
      status: 'active',
      createdById: opts.userId,
    })
    .returning({ id: services.id })
  for (const [i, cell] of (opts.cells ?? []).entries()) {
    await tx.insert(servicePrices).values({
      serviceId: svc.id,
      variantName: cell.variantName,
      price: cell.price,
      sortOrder: i,
    })
  }
  return svc.id
}

describe.skipIf(noDb)('G01 — resolveServicePrice reports the additional-unit price', () => {
  it('gives it when the type is billed in steps and the service has the price', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const scopeId = await makeScope(tx, { stepped: true })
      const serviceId = await makeService(tx, { userId, scopeId, additionalUnitPrice: 6000 })

      const r = await resolveServicePrice(tx, { serviceId, quantity: 3 })

      expect(r?.unitPrice).toBe(10000)
      expect(r?.quantity).toBe(3)
      expect(r?.additionalUnitPrice).toBe(6000)
    })
  })

  it('gives none when the type’s toggle is off, even though the service has the price', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const scopeId = await makeScope(tx, { stepped: false })
      const serviceId = await makeService(tx, { userId, scopeId, additionalUnitPrice: 6000 })

      const r = await resolveServicePrice(tx, { serviceId, quantity: 3 })

      expect(r?.additionalUnitPrice).toBeNull()
    })
  })

  it('gives none when the type is stepped but the service has no additional price', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const scopeId = await makeScope(tx, { stepped: true })
      const serviceId = await makeService(tx, { userId, scopeId, additionalUnitPrice: null })

      const r = await resolveServicePrice(tx, { serviceId, quantity: 3 })

      expect(r?.additionalUnitPrice).toBeNull()
    })
  })

  it('gives none for a service with no application type at all', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const serviceId = await makeService(tx, { userId, scopeId: null, additionalUnitPrice: 6000 })

      const r = await resolveServicePrice(tx, { serviceId, quantity: 3 })

      expect(r?.additionalUnitPrice).toBeNull()
    })
  })

  it('keeps a free further unit (0) as a price, not as “none”', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const scopeId = await makeScope(tx, { stepped: true })
      const serviceId = await makeService(tx, { userId, scopeId, additionalUnitPrice: 0 })

      const r = await resolveServicePrice(tx, { serviceId, quantity: 3 })

      expect(r?.additionalUnitPrice).toBe(0)
    })
  })

  it('pairs the chosen variant’s first-unit price with the same additional price', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const scopeId = await makeScope(tx, { stepped: true })
      const serviceId = await makeService(tx, {
        userId,
        scopeId,
        additionalUnitPrice: 6000,
        cells: [
          { variantName: 'Simple', price: 10000 },
          { variantName: 'Surgical', price: 20000 },
        ],
      })

      const simple = await resolveServicePrice(tx, {
        serviceId,
        variantName: 'Simple',
        quantity: 2,
      })
      const surgical = await resolveServicePrice(tx, {
        serviceId,
        variantName: 'Surgical',
        quantity: 2,
      })

      expect([simple?.unitPrice, simple?.additionalUnitPrice]).toEqual([10000, 6000])
      expect([surgical?.unitPrice, surgical?.additionalUnitPrice]).toEqual([20000, 6000])
    })
  })

  it('still caps the quantity at the type’s maximum', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const scopeId = await makeScope(tx, { stepped: true, max: 4 })
      const serviceId = await makeService(tx, { userId, scopeId, additionalUnitPrice: 6000 })

      const r = await resolveServicePrice(tx, { serviceId, quantity: 9 })

      expect(r?.quantity).toBe(4)
    })
  })
})

describe.skipIf(noDb)('G01 — an estimate prices a stepped service on the server', () => {
  async function estimateOf(tx: DB, serviceId: string, quantity: number, userId: string) {
    const patientId = await makePatient(tx)
    const { invoice } = await createEstimateDraft(
      tx,
      { patientId, lines: [{ serviceId, quantity }] },
      userId
    )
    const lines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoice.id))
    return { invoice, line: lines[0] }
  }

  it('bills the first unit and the further units at their own prices', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const scopeId = await makeScope(tx, { stepped: true })
      const serviceId = await makeService(tx, { userId, scopeId, additionalUnitPrice: 6000 })

      const { invoice, line } = await estimateOf(tx, serviceId, 3, userId)

      expect(Number(line.quantity)).toBe(3)
      expect(line.unitPrice).toBe(10000)
      expect(line.lineSubtotal).toBe(22000) // 10000 + 2 × 6000
      expect(invoice.subtotal).toBe(22000)
      expect(invoice.total).toBe(22000)
    })
  })

  it('bills flat when the type’s toggle is off, whatever the service carries', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const scopeId = await makeScope(tx, { stepped: false })
      const serviceId = await makeService(tx, { userId, scopeId, additionalUnitPrice: 6000 })

      const { invoice, line } = await estimateOf(tx, serviceId, 3, userId)

      expect(line.lineSubtotal).toBe(30000)
      expect(invoice.total).toBe(30000)
    })
  })

  it('bills the chosen variant’s first unit plus the further units at the additional price', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const scopeId = await makeScope(tx, { stepped: true })
      const serviceId = await makeService(tx, {
        userId,
        scopeId,
        additionalUnitPrice: 6000,
        cells: [
          { variantName: 'Simple', price: 10000 },
          { variantName: 'Surgical', price: 20000 },
        ],
      })
      const patientId = await makePatient(tx)

      const { invoice } = await createEstimateDraft(
        tx,
        { patientId, lines: [{ serviceId, quantity: 3, variantName: 'Surgical' }] },
        userId
      )

      expect(invoice.subtotal).toBe(32000) // 20000 + 2 × 6000
    })
  })

  it('leaves an estimate already made as it was when the toggle is switched on later', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const scopeId = await makeScope(tx, { stepped: false })
      const serviceId = await makeService(tx, { userId, scopeId, additionalUnitPrice: 6000 })
      const before = await estimateOf(tx, serviceId, 3, userId)
      expect(before.invoice.total).toBe(30000)

      await tx
        .update(applicationScopes)
        .set({ additionalUnitPriceEnabled: true })
        .where(eq(applicationScopes.id, scopeId))

      // The one already made is stored as it was: nothing recomputes it.
      const [stored] = await tx.select().from(invoices).where(eq(invoices.id, before.invoice.id))
      const [storedLine] = await tx
        .select()
        .from(invoiceLines)
        .where(eq(invoiceLines.invoiceId, before.invoice.id))
      expect(stored.total).toBe(30000)
      expect(storedLine.lineSubtotal).toBe(30000)

      // A new one is priced by the new rule.
      const after = await estimateOf(tx, serviceId, 3, userId)
      expect(after.invoice.total).toBe(22000)
    })
  })

  it('bills one unit at the first-unit price alone', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const scopeId = await makeScope(tx, { stepped: true })
      const serviceId = await makeService(tx, { userId, scopeId, additionalUnitPrice: 6000 })

      const { invoice } = await estimateOf(tx, serviceId, 1, userId)

      expect(invoice.total).toBe(10000)
    })
  })
})
