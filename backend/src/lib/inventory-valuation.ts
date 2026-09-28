/**
 * inventory-valuation.ts — stock value under the clinic's valuation method
 * (Settings → Inventory → Store Policies, `inventory:policies.valuationMethod`;
 * settings-domain-audit S5-B).
 *
 *   fifo             — remaining batch quantities at their own receipt cost.
 *                      Stock no batch covers (opening balances, legacy rows)
 *                      is valued at the item's costPrice.
 *   weighted_average — quantity × items.costPrice, which receiveStock keeps as
 *                      the running weighted-average cost under this method.
 *
 * All money is integer pesewas; results are rounded to the pesewa.
 */

import { and, eq, gt, inArray } from 'drizzle-orm'
import type { DB } from '../db'
import { inventoryBatches, items } from '../db/schema'
import type { ValuationMethod } from './settings-store'

export interface BatchLike {
  qtyRemaining: number
  unitCost: number | null
}

/** Running weighted-average cost after receiving `qty` at `unitCost`. */
export function weightedAverageCost(
  oldQty: number,
  oldCost: number | null,
  qty: number,
  unitCost: number
): number {
  if (qty <= 0) return oldCost ?? unitCost
  if (oldQty <= 0 || oldCost === null) return unitCost
  return Math.round((oldQty * oldCost + qty * unitCost) / (oldQty + qty))
}

/** FIFO value of one item: batches at their cost, uncovered stock at costPrice. */
export function fifoItemValue(
  batches: BatchLike[],
  stockQuantity: number,
  costPrice: number | null
): number {
  const fallback = costPrice ?? 0
  let covered = 0
  let value = 0
  for (const b of batches) {
    if (b.qtyRemaining <= 0) continue
    covered += b.qtyRemaining
    value += b.qtyRemaining * (b.unitCost ?? fallback)
  }
  const uncovered = Math.max(0, stockQuantity - covered)
  return Math.round(value + uncovered * fallback)
}

export function averageItemValue(stockQuantity: number, costPrice: number | null): number {
  return Math.round(Math.max(0, stockQuantity) * (costPrice ?? 0))
}

export function itemStockValue(
  method: ValuationMethod,
  batches: BatchLike[],
  stockQuantity: number,
  costPrice: number | null
): number {
  return method === 'weighted_average'
    ? averageItemValue(stockQuantity, costPrice)
    : fifoItemValue(batches, stockQuantity, costPrice)
}

export interface ConsumedBatch {
  take: number
  unitCost: number | null
}

/** Cost of goods for an issue: FIFO at the consumed batches' cost, average at costPrice. */
export function cogsForIssue(
  method: ValuationMethod,
  consumed: ConsumedBatch[],
  uncoveredQty: number,
  costPrice: number | null
): number {
  const fallback = costPrice ?? 0
  if (method === 'weighted_average') {
    const qty = consumed.reduce((sum, c) => sum + c.take, 0) + uncoveredQty
    return Math.round(qty * fallback)
  }
  const batchCost = consumed.reduce((sum, c) => sum + c.take * (c.unitCost ?? fallback), 0)
  return Math.round(batchCost + uncoveredQty * fallback)
}

async function batchesByItem(db: DB, itemIds: string[]): Promise<Map<string, BatchLike[]>> {
  const map = new Map<string, BatchLike[]>()
  if (itemIds.length === 0) return map
  const rows = await db
    .select({
      itemId: inventoryBatches.itemId,
      qtyRemaining: inventoryBatches.qtyRemaining,
      unitCost: inventoryBatches.unitCost,
    })
    .from(inventoryBatches)
    .where(and(inArray(inventoryBatches.itemId, itemIds), gt(inventoryBatches.qtyRemaining, 0)))
  for (const r of rows) {
    const list = map.get(r.itemId) ?? []
    list.push({ qtyRemaining: r.qtyRemaining, unitCost: r.unitCost })
    map.set(r.itemId, list)
  }
  return map
}

/** Value of every consumable item in stock. */
export async function valueInventory(
  db: DB,
  method: ValuationMethod
): Promise<{ totalValue: number; itemCount: number }> {
  const rows = await db
    .select({ id: items.id, stockQuantity: items.stockQuantity, costPrice: items.costPrice })
    .from(items)
    .where(and(eq(items.consumable, true), gt(items.stockQuantity, 0)))
  const batches =
    method === 'fifo'
      ? await batchesByItem(
          db,
          rows.map((r) => r.id)
        )
      : new Map<string, BatchLike[]>()
  let totalValue = 0
  for (const r of rows) {
    totalValue += itemStockValue(method, batches.get(r.id) ?? [], r.stockQuantity, r.costPrice)
  }
  return { totalValue, itemCount: rows.length }
}

/** Value of one item (0 when it has no stock). */
export async function valueItem(
  db: DB,
  method: ValuationMethod,
  item: { id: string; stockQuantity: number; costPrice: number | null }
): Promise<number> {
  if (item.stockQuantity <= 0) return 0
  const batches = method === 'fifo' ? ((await batchesByItem(db, [item.id])).get(item.id) ?? []) : []
  return itemStockValue(method, batches, item.stockQuantity, item.costPrice)
}
