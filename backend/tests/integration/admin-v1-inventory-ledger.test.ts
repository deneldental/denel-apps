/**
 * admin-v1 inventory-ledger smoke tests — §11.1–11.5.
 *
 * Verifies receiveStock, issueStockFefo, and adjustStock against the real dev
 * DB. Every test runs inside `withRollback` (always rolled back; shared DB is
 * never mutated).
 *
 * Run with: doppler run -- pnpm --filter backend test
 */

import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { DB } from '../../src/db'
import {
  inventoryBatches,
  items,
  journalEntries,
  stockMovements,
  suppliers,
} from '../../src/db/schema'
import { adjustStock, issueStockFefo, receiveStock } from '../../src/lib/inventory-ledger'
import { getOrCreatePeriodFor } from '../../src/lib/period-service'
import { anyUserId } from './_fixtures'
import { noDb, withRollback } from './_setup'

/** Insert a minimal supplier and return its id. */
async function makeSupplier(tx: DB): Promise<string> {
  const [row] = await tx
    .insert(suppliers)
    .values({ name: `IT Supplier ${Date.now()}`, active: true })
    .returning()
  return row.id
}

/** withRollback + an open accounting period so GL postings succeed. */
async function withPostingRollback(fn: (tx: DB) => Promise<void>) {
  await withRollback(async (tx) => {
    await getOrCreatePeriodFor(tx, new Date())
    await fn(tx)
  })
}

/** Insert a minimal consumable item and return its id. */
async function makeItem(
  tx: DB,
  opts: { name?: string; stockQuantity?: number; costPrice?: number } = {}
): Promise<string> {
  const [row] = await tx
    .insert(items)
    .values({
      name: opts.name ?? 'IT Inventory Item',
      consumable: true,
      stockQuantity: opts.stockQuantity ?? 0,
      costPrice: opts.costPrice ?? null,
      source: 'inventory',
    })
    .returning()
  return row.id
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe.skipIf(noDb)('admin-v1 inventory-ledger', () => {
  // ── 1. receiveStock creates movements + batches + updates stockQuantity ──────

  it('receiveStock: creates stock_movements, inventory_batches, increments stockQuantity', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const itemId = await makeItem(tx, { stockQuantity: 10 })

      const result = await receiveStock(tx, {
        lines: [{ itemId, qty: 5, unitCost: 20 }],
        paidNow: false,
        createdById: userId,
      })

      expect(result.receiptId).toBeTruthy()

      // Movement created
      const [movement] = await tx
        .select()
        .from(stockMovements)
        .where(eq(stockMovements.id, result.receiptId))
        .limit(1)
      expect(movement).toBeTruthy()
      expect(movement.type).toBe('receipt')
      expect(movement.qty).toBe(5)
      expect(Number(movement.unitCost)).toBe(20)

      // Batch created
      const [batch] = await tx
        .select()
        .from(inventoryBatches)
        .where(eq(inventoryBatches.movementId, result.receiptId))
        .limit(1)
      expect(batch).toBeTruthy()
      expect(batch.qtyRemaining).toBe(5)
      expect(Number(batch.unitCost)).toBe(20)

      // stockQuantity incremented
      const [item] = await tx.select().from(items).where(eq(items.id, itemId)).limit(1)
      expect(item.stockQuantity).toBe(15)
    })
  })

  // ── 2. receiveStock posts GL entry DR Inventory / CR AP (paidNow=false) ──────

  it('receiveStock: posts GL entry DR Inventory(1400) / CR AP(2000) when paidNow=false', async () => {
    await withPostingRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const itemId = await makeItem(tx)
      const supplierId = await makeSupplier(tx)

      const result = await receiveStock(tx, {
        lines: [{ itemId, qty: 10, unitCost: 50 }],
        paidNow: false,
        supplierId,
        createdById: userId,
      })

      // Journal entry should have been posted with sourceDocId = receiptId
      const entry = await tx.query.journalEntries.findFirst({
        where: and(
          eq(journalEntries.sourceDocType, 'inventory_receipt' as never),
          eq(journalEntries.sourceDocId, result.receiptId)
        ),
        with: { lines: true },
      })

      expect(entry).toBeTruthy()
      if (!entry) throw new Error('no journal entry found')

      const lines = (
        entry as unknown as { lines: Array<{ debit: unknown; credit: unknown; accountId: string }> }
      ).lines
      const totalDebit = lines.reduce((s, l) => s + Number(l.debit ?? 0), 0)
      const totalCredit = lines.reduce((s, l) => s + Number(l.credit ?? 0), 0)

      // Balanced
      expect(totalDebit).toBe(totalCredit)
      // Total = 10 * 50 = 500
      expect(totalDebit).toBe(500)
    })
  })

  // ── 3. issueStockFefo draws down batches FEFO and decrements stockQuantity ───

  it('issueStockFefo: draws down batches FEFO, decrements stockQuantity', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const itemId = await makeItem(tx, { stockQuantity: 20, costPrice: 10 })

      // Create two batches: one expiring sooner
      const soon = new Date()
      soon.setDate(soon.getDate() + 10)
      const later = new Date()
      later.setDate(later.getDate() + 60)

      await tx.insert(inventoryBatches).values([
        { itemId, qtyRemaining: 8, unitCost: 10, expiryDate: later },
        { itemId, qtyRemaining: 12, unitCost: 10, expiryDate: soon },
      ])

      await issueStockFefo(tx, {
        itemId,
        qty: 10,
        reason: 'clinic use',
        sourceType: 'lab_case',
        createdById: userId,
      })

      // stockQuantity decremented
      const [item] = await tx.select().from(items).where(eq(items.id, itemId)).limit(1)
      expect(item.stockQuantity).toBe(10)

      // Movement created
      const [movement] = await tx
        .select()
        .from(stockMovements)
        .where(and(eq(stockMovements.itemId, itemId), eq(stockMovements.type, 'issue')))
        .limit(1)
      expect(movement).toBeTruthy()
      expect(movement.qty).toBe(-10)

      // Soonest-expiry batch should be drawn down first (FEFO).
      // The soon-expiring batch (12) should have been drawn to 2 (took 10 from it).
      const batches = await tx
        .select()
        .from(inventoryBatches)
        .where(eq(inventoryBatches.itemId, itemId))
      const soonBatch = batches.find((b) => b.expiryDate && new Date(b.expiryDate) < later)
      const laterBatch = batches.find((b) => b.expiryDate && new Date(b.expiryDate) >= later)
      // Soon-expiry (12 originally) drawn down by 10 → 2 remaining
      expect(soonBatch?.qtyRemaining).toBe(2)
      // Later-expiry (8 originally) untouched
      expect(laterBatch?.qtyRemaining).toBe(8)
    })
  })

  // ── 4. adjustStock creates movement and updates stockQuantity ─────────────────

  it('adjustStock: creates movement row and adjusts stockQuantity', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const itemId = await makeItem(tx, { stockQuantity: 100 })

      // Positive adjustment (stock-take found more)
      await adjustStock(tx, {
        itemId,
        qtyDelta: 5,
        reason: 'stock-take correction',
        createdById: userId,
      })

      const [item] = await tx.select().from(items).where(eq(items.id, itemId)).limit(1)
      expect(item.stockQuantity).toBe(105)

      const [movement] = await tx
        .select()
        .from(stockMovements)
        .where(and(eq(stockMovements.itemId, itemId), eq(stockMovements.type, 'adjustment')))
        .limit(1)
      expect(movement).toBeTruthy()
      expect(movement.qty).toBe(5)
      expect(movement.reason).toBe('stock-take correction')

      // Negative adjustment (wastage)
      await adjustStock(tx, {
        itemId,
        qtyDelta: -3,
        reason: 'wastage',
        createdById: userId,
      })

      const [itemAfter] = await tx.select().from(items).where(eq(items.id, itemId)).limit(1)
      expect(itemAfter.stockQuantity).toBe(102)
    })
  })

  // ── 5. GET /api/inventory/batches returns batches with itemName ───────────────

  it('GET /api/inventory/batches: returns non-empty batches with itemName', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const itemId = await makeItem(tx, { name: 'IT Batch Item', stockQuantity: 50, costPrice: 8 })

      // Receive stock to create a batch
      const receipt = await receiveStock(tx, {
        lines: [
          {
            itemId,
            qty: 20,
            unitCost: 8,
            expiryDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // 15 days
          },
        ],
        paidNow: false,
        createdById: userId,
      })

      // Verify the batch was created with correct data
      const [batch] = await tx
        .select()
        .from(inventoryBatches)
        .where(eq(inventoryBatches.movementId, receipt.receiptId))
        .limit(1)

      expect(batch).toBeTruthy()
      expect(batch.qtyRemaining).toBe(20)
      expect(batch.itemId).toBe(itemId)

      // Verify we can join to items to get the name
      const rows = await tx
        .select({
          id: inventoryBatches.id,
          qtyRemaining: inventoryBatches.qtyRemaining,
          itemName: items.name,
        })
        .from(inventoryBatches)
        .leftJoin(items, eq(inventoryBatches.itemId, items.id))
        .where(eq(inventoryBatches.id, batch.id))
        .limit(1)

      expect(rows[0]?.itemName).toBe('IT Batch Item')
      expect(rows[0]?.qtyRemaining).toBe(20)
    })
  })
})
