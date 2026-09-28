/**
 * inventory-ledger.ts — admin-v1 §11.1–11.5
 *
 * Services for the inventory ledger: costed receipts (§11.2), FEFO issue
 * (§11.3/11.4), and one-off adjustments (§11.5). Every stock event creates a
 * stock_movements row; receipts also create inventory_batches rows. GL
 * postings are best-effort (caught + logged) so a period-accounting error
 * never blocks a stock operation.
 */

import { and, asc, eq, gt, sql } from 'drizzle-orm'
import type { DB } from '../db'
import { inventoryBatches, items, journalEntries, stockMovements } from '../db/schema'
import { getAccountByCode, resolveChannelAccountId } from './channel-accounts'
import { FINANCE_ACCOUNTS } from './finance-accounts'
import { postInOpenPeriod } from './gl-service'
import { type ConsumedBatch, cogsForIssue, weightedAverageCost } from './inventory-valuation'
import { logError } from './logger'
import { getInventoryPolicies } from './settings-store'

// ── receiveStock (§11.2) ──────────────────────────────────────────────────────

export interface ReceiveStockLine {
  itemId: string
  qty: number
  unitCost: number
  locationId?: string | null
  expiryDate?: Date | null
  lotNumber?: string | null
}

export interface ReceiveStockInput {
  lines: ReceiveStockLine[]
  supplierId?: string | null
  notes?: string | null
  /** true = paid on delivery; credit Cash/Bank. false = on account; credit AP. */
  paidNow: boolean
  /** Channel name (e.g. 'cash', 'bank_transfer'). Required when paidNow=true. */
  paymentMethod?: string | null
  receiptUrl?: string | null
  createdById: string
  date?: Date
}

/**
 * receiveStock — costed Goods-Received receipt (§11.2).
 *
 * For each line:
 *   1. Inserts a stock_movements row (type='receipt').
 *   2. Inserts an inventory_batches row (qtyRemaining = line.qty).
 *   3. Increments items.stockQuantity.
 *
 * Then posts a single balanced GL entry:
 *   DR Inventory (1400) / CR Cash|Bank (paidNow) or AP (2000) (on account).
 *
 * Returns the id of the first movement row (serves as the receipt reference).
 */
export async function receiveStock(
  db: DB,
  input: ReceiveStockInput
): Promise<{ receiptId: string }> {
  const date = input.date ?? new Date()
  const movementIds: string[] = []
  // Under weighted_average, items.costPrice is the running average cost and
  // every receipt moves it (settings-domain-audit S5-B).
  const policies = await getInventoryPolicies(db)

  // ── 1+2+3: movements, batches, stockQuantity ──────────────────────────────
  for (const [lineIdx, line] of input.lines.entries()) {
    const [movement] = await db
      .insert(stockMovements)
      .values({
        itemId: line.itemId,
        type: 'receipt',
        qty: line.qty,
        unitCost: line.unitCost,
        locationId: line.locationId ?? null,
        // Store the receipt document URL on the first line only
        receiptUrl: lineIdx === 0 ? (input.receiptUrl ?? null) : null,
        sourceType: 'receive',
        createdById: input.createdById,
        createdAt: date,
      })
      .returning()

    movementIds.push(movement.id)

    await db.insert(inventoryBatches).values({
      itemId: line.itemId,
      locationId: line.locationId ?? null,
      movementId: movement.id,
      qtyRemaining: line.qty,
      unitCost: line.unitCost,
      expiryDate: line.expiryDate ?? null,
      lotNumber: line.lotNumber ?? null,
    })

    if (policies.valuationMethod === 'weighted_average') {
      const [before] = await db
        .select({ stockQuantity: items.stockQuantity, costPrice: items.costPrice })
        .from(items)
        .where(eq(items.id, line.itemId))
        .limit(1)
      const costPrice = weightedAverageCost(
        before?.stockQuantity ?? 0,
        before?.costPrice ?? null,
        line.qty,
        line.unitCost
      )
      await db
        .update(items)
        .set({ stockQuantity: sql`${items.stockQuantity} + ${line.qty}`, costPrice })
        .where(eq(items.id, line.itemId))
    } else {
      await db
        .update(items)
        .set({ stockQuantity: sql`${items.stockQuantity} + ${line.qty}` })
        .where(eq(items.id, line.itemId))
    }
  }

  const firstMovementId = movementIds[0]

  // ── 4: GL posting (best-effort) ───────────────────────────────────────────
  try {
    const totalCost = input.lines.reduce((sum, l) => sum + l.qty * l.unitCost, 0)

    if (totalCost > 0 && firstMovementId) {
      // Resolve the inventory asset account id.
      const inventoryAccount = await getAccountByCode(db, FINANCE_ACCOUNTS.INVENTORY)

      // Resolve the credit account: cash/bank channel or AP.
      // Build credit line. AP (2000) is a control account — requires partyType+partyId.
      // Skip the GL post if on account but no supplier is known (avoids the control check).
      let creditLine: import('./gl-service').JournalLineInput | null = null
      if (input.paidNow && input.paymentMethod) {
        const cashAccountId = await resolveChannelAccountId(db, input.paymentMethod as never)
        creditLine = { accountId: cashAccountId, credit: totalCost }
      } else if (input.supplierId) {
        const apAccount = await getAccountByCode(db, FINANCE_ACCOUNTS.AP)
        creditLine = {
          accountId: apAccount.id,
          credit: totalCost,
          partyType: 'supplier',
          partyId: input.supplierId,
        }
      }

      if (creditLine) {
        const result = await postInOpenPeriod(
          db,
          {
            sourceDocType: 'inventory_receipt',
            sourceDocId: firstMovementId,
            description: input.notes ?? 'Inventory receipt',
            lines: [{ accountId: inventoryAccount.id, debit: totalCost }, creditLine],
            createdBy: input.createdById,
          },
          date
        )

        // Stamp journalEntryId on the first movement if posting succeeded.
        if (result === 'posted') {
          const entry = await db.query.journalEntries.findFirst({
            where: and(
              eq(journalEntries.sourceDocType, 'inventory_receipt'),
              eq(journalEntries.sourceDocId, firstMovementId)
            ),
          })
          if (entry) {
            await db
              .update(stockMovements)
              .set({ journalEntryId: entry.id })
              .where(eq(stockMovements.id, firstMovementId))
          }
        }
      }
      // No creditLine = on-account with no supplier — skip GL; stock is still recorded.
    }
  } catch (err) {
    logError(err, { context: '[inventory-ledger] receiveStock GL posting failed' })
  }

  return { receiptId: firstMovementId }
}

// ── FEFO draw-down (shared by issues and negative adjustments) ────────────────

/**
 * Consume `qty` from an item's batches, earliest expiry first (null expiry
 * last, then oldest receipt). Returns what was taken from which batch and how
 * much no batch could cover — the ledger records the movement either way.
 */
async function drawDownBatchesFefo(
  db: DB,
  itemId: string,
  qty: number
): Promise<{ consumed: ConsumedBatch[]; uncovered: number }> {
  const batches = await db
    .select()
    .from(inventoryBatches)
    .where(and(eq(inventoryBatches.itemId, itemId), gt(inventoryBatches.qtyRemaining, 0)))
    .orderBy(
      // FEFO: null expiry last, then by createdAt
      sql`${inventoryBatches.expiryDate} ASC NULLS LAST`,
      asc(inventoryBatches.createdAt)
    )

  const consumed: ConsumedBatch[] = []
  let remaining = qty
  for (const batch of batches) {
    if (remaining <= 0) break
    const take = Math.min(remaining, batch.qtyRemaining)
    await db
      .update(inventoryBatches)
      .set({ qtyRemaining: batch.qtyRemaining - take })
      .where(eq(inventoryBatches.id, batch.id))
    consumed.push({ take, unitCost: batch.unitCost })
    remaining -= take
  }
  return { consumed, uncovered: remaining }
}

// ── issueStockFefo (§11.3/11.4) ───────────────────────────────────────────────

export interface IssueStockInput {
  itemId: string
  qty: number
  reason: string
  sourceType: string
  sourceId?: string | null
  locationId?: string | null
  /** Post DR COGS(5000) / CR Inventory(1400). Default false (periodic method). */
  postCogs?: boolean
  createdById: string
}

/**
 * issueStockFefo — consume qty from the oldest-expiry batches first (FEFO).
 *
 * Draws down inventory_batches rows ordered by expiryDate ASC NULLS LAST,
 * then by createdAt ASC. Items with insufficient batch qty still get the
 * movement recorded (best-effort). Decrements items.stockQuantity.
 *
 * If postCogs=true: posts DR COGS(5000) / CR Inventory(1400) — best-effort.
 */
export async function issueStockFefo(db: DB, input: IssueStockInput): Promise<void> {
  // ── 1: movement row ───────────────────────────────────────────────────────
  await db.insert(stockMovements).values({
    itemId: input.itemId,
    type: 'issue',
    qty: -input.qty,
    locationId: input.locationId ?? null,
    reason: input.reason,
    sourceType: input.sourceType,
    sourceId: input.sourceId ?? null,
    createdById: input.createdById,
  })

  // ── 2: draw down batches FEFO ─────────────────────────────────────────────
  const { consumed, uncovered } = await drawDownBatchesFefo(db, input.itemId, input.qty)

  // ── 3: decrement stockQuantity ────────────────────────────────────────────
  await db
    .update(items)
    .set({ stockQuantity: sql`${items.stockQuantity} - ${input.qty}` })
    .where(eq(items.id, input.itemId))

  // ── 4: optional COGS posting (best-effort) ────────────────────────────────
  if (input.postCogs) {
    try {
      // Cost follows the clinic's valuation method (settings-domain-audit
      // S5-B): FIFO at the consumed batches' receipt cost, weighted average at
      // items.costPrice.
      const [itemRow] = await db.select().from(items).where(eq(items.id, input.itemId)).limit(1)
      const { valuationMethod } = await getInventoryPolicies(db)
      const totalCost = cogsForIssue(
        valuationMethod,
        consumed,
        uncovered,
        itemRow?.costPrice ?? null
      )

      if (totalCost > 0) {
        const cogsAccount = await getAccountByCode(db, FINANCE_ACCOUNTS.COGS)
        const invAccount = await getAccountByCode(db, FINANCE_ACCOUNTS.INVENTORY)

        await postInOpenPeriod(
          db,
          {
            sourceDocType: 'retail_sale',
            sourceDocId: input.sourceId ?? null,
            description: `COGS — ${input.reason}`,
            lines: [
              { accountId: cogsAccount.id, debit: totalCost },
              { accountId: invAccount.id, credit: totalCost },
            ],
            createdBy: input.createdById,
          },
          new Date()
        )
      }
    } catch (err) {
      logError(err, { context: '[inventory-ledger] issueStockFefo COGS posting failed' })
    }
  }
}

// ── adjustStock (§11.5) ───────────────────────────────────────────────────────

export interface AdjustStockInput {
  itemId: string
  /** Positive = add, negative = remove. */
  qtyDelta: number
  reason: string
  locationId?: string | null
  createdById: string
}

/**
 * adjustStock — one-off quantity adjustment (stock-take correction, wastage, etc).
 *
 * Inserts a stock_movements row (type='adjustment') carrying the reason and
 * moves items.stockQuantity by qtyDelta. Batches stay in step so the
 * expiring-soon list and the FIFO value keep matching the count
 * (settings-domain-audit S5-B): a removal draws batches down FEFO, an
 * addition gets a batch at the item's current cost with no expiry.
 * No GL posting — adjustments are reconciled manually via journal entries (§11.5).
 */
export async function adjustStock(
  db: DB,
  input: AdjustStockInput
): Promise<{ movementId: string }> {
  const [movement] = await db
    .insert(stockMovements)
    .values({
      itemId: input.itemId,
      type: 'adjustment',
      qty: input.qtyDelta,
      locationId: input.locationId ?? null,
      reason: input.reason,
      createdById: input.createdById,
    })
    .returning({ id: stockMovements.id })

  if (input.qtyDelta < 0) {
    await drawDownBatchesFefo(db, input.itemId, -input.qtyDelta)
  } else if (input.qtyDelta > 0) {
    const [item] = await db
      .select({ costPrice: items.costPrice })
      .from(items)
      .where(eq(items.id, input.itemId))
      .limit(1)
    await db.insert(inventoryBatches).values({
      itemId: input.itemId,
      locationId: input.locationId ?? null,
      movementId: movement.id,
      qtyRemaining: input.qtyDelta,
      unitCost: item?.costPrice ?? null,
      expiryDate: null,
      lotNumber: null,
    })
  }

  await db
    .update(items)
    .set({ stockQuantity: sql`${items.stockQuantity} + ${input.qtyDelta}` })
    .where(eq(items.id, input.itemId))

  return { movementId: movement.id }
}
