/**
 * settings-domain-audit S5-B (inventory) against a real Postgres:
 *   - under `weighted_average`, receiveStock keeps items.costPrice as the
 *     running average; under `fifo` it leaves it alone;
 *   - adjustStock keeps inventory_batches in step with stockQuantity
 *     (negative draws down FEFO, positive adds a batch at item cost);
 *   - valueItem / valueInventory follow the method.
 * Everything runs inside withRollback. Run with
 * `node scripts/dev-local.mjs npx vitest run tests/integration/inventory-policies.test.ts`.
 */
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { DB } from '../../src/db'
import { clinicSettings, inventoryBatches, items, stockMovements } from '../../src/db/schema'
import { adjustStock, receiveStock } from '../../src/lib/inventory-ledger'
import { valueInventory, valueItem } from '../../src/lib/inventory-valuation'
import { INVENTORY_POLICIES_KEY } from '../../src/lib/settings-store'
import { anyUserId } from './_fixtures'
import { noDb, withRollback } from './_setup'

async function setMethod(tx: DB, valuationMethod: 'fifo' | 'weighted_average') {
  await tx
    .insert(clinicSettings)
    .values({ key: INVENTORY_POLICIES_KEY, value: { valuationMethod } })
    .onConflictDoUpdate({
      target: clinicSettings.key,
      set: { value: { valuationMethod }, updatedAt: new Date() },
    })
}

async function makeItem(tx: DB, stockQuantity: number, costPrice: number | null) {
  const [row] = await tx
    .insert(items)
    .values({
      name: `IT S5B ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      consumable: true,
      stockQuantity,
      costPrice,
    })
    .returning({ id: items.id })
  return row.id
}

const itemRow = async (tx: DB, id: string) =>
  (await tx.select().from(items).where(eq(items.id, id)).limit(1))[0]
const batchesOf = (tx: DB, id: string) =>
  tx.select().from(inventoryBatches).where(eq(inventoryBatches.itemId, id))

describe.skipIf(noDb)('inventory policies (S5-B)', () => {
  it('weighted_average: a receipt moves costPrice to the running average', async () => {
    await withRollback(async (tx) => {
      await setMethod(tx, 'weighted_average')
      const userId = await anyUserId(tx)
      const itemId = await makeItem(tx, 10, 100)
      await receiveStock(tx, {
        lines: [{ itemId, qty: 10, unitCost: 200 }],
        paidNow: false,
        createdById: userId,
      })
      const row = await itemRow(tx, itemId)
      expect(row.stockQuantity).toBe(20)
      expect(row.costPrice).toBe(150)
      expect(await valueItem(tx, 'weighted_average', row)).toBe(3000)
    })
  })

  it('fifo: a receipt leaves costPrice alone and values batches at their own cost', async () => {
    await withRollback(async (tx) => {
      await setMethod(tx, 'fifo')
      const userId = await anyUserId(tx)
      const itemId = await makeItem(tx, 10, 100)
      await receiveStock(tx, {
        lines: [{ itemId, qty: 10, unitCost: 200 }],
        paidNow: false,
        createdById: userId,
      })
      const row = await itemRow(tx, itemId)
      expect(row.costPrice).toBe(100)
      // 10 opening units no batch covers at 100 + 10 in the batch at 200.
      expect(await valueItem(tx, 'fifo', row)).toBe(3000)
    })
  })

  it('adjustStock keeps batches in step: FEFO draw-down on removal, a costed batch on addition', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const itemId = await makeItem(tx, 0, 120)
      const soon = new Date(Date.now() + 5 * 86_400_000)
      const later = new Date(Date.now() + 60 * 86_400_000)
      await receiveStock(tx, {
        lines: [
          { itemId, qty: 10, unitCost: 100, expiryDate: later },
          { itemId, qty: 3, unitCost: 100, expiryDate: soon },
        ],
        paidNow: false,
        createdById: userId,
      })

      await adjustStock(tx, { itemId, qtyDelta: -5, reason: 'Expired Stock', createdById: userId })
      let batches = await batchesOf(tx, itemId)
      expect(batches.map((b) => b.qtyRemaining).sort((a, b) => a - b)).toEqual([0, 8])
      const emptied = batches.find((b) => b.qtyRemaining === 0)
      const kept = batches.find((b) => b.qtyRemaining === 8)
      const emptiedExpiry = emptied?.expiryDate?.getTime() ?? Number.NaN
      const keptExpiry = kept?.expiryDate?.getTime() ?? Number.NaN
      expect(emptiedExpiry).toBeLessThan(keptExpiry)
      expect((await itemRow(tx, itemId)).stockQuantity).toBe(8)

      const { movementId } = await adjustStock(tx, {
        itemId,
        qtyDelta: 4,
        reason: 'Count Variance',
        createdById: userId,
      })
      batches = await batchesOf(tx, itemId)
      const added = batches.find((b) => b.movementId === movementId)
      expect(added).toMatchObject({ qtyRemaining: 4, unitCost: 120, expiryDate: null })
      expect((await itemRow(tx, itemId)).stockQuantity).toBe(12)
      const [movement] = await tx
        .select()
        .from(stockMovements)
        .where(and(eq(stockMovements.id, movementId), eq(stockMovements.type, 'adjustment')))
        .limit(1)
      expect(movement?.qty).toBe(4)
    })
  })

  it('valueInventory adds the item under the method', async () => {
    await withRollback(async (tx) => {
      const before = await valueInventory(tx, 'fifo')
      const userId = await anyUserId(tx)
      const itemId = await makeItem(tx, 0, null)
      await receiveStock(tx, {
        lines: [{ itemId, qty: 4, unitCost: 250 }],
        paidNow: false,
        createdById: userId,
      })
      const after = await valueInventory(tx, 'fifo')
      expect(after.totalValue - before.totalValue).toBe(1000)
      expect(after.itemCount - before.itemCount).toBe(1)
    })
  })
})
