/**
 * insurance-pricing-service.ts — resolve an insurer's negotiated price for one of
 * our services, from the company's currently-effective CSV price list.
 *
 * Only rows whose mapping is 'approved' are billable; anything pending/rejected
 * returns null (the caller must treat the treatment as not-billable-to-insurer).
 */
import { and, eq } from 'drizzle-orm'
import type { getDb } from '../db'
import { insurancePriceListItems, insurancePriceLists } from '../db/schema'

type Db = ReturnType<typeof getDb>

/**
 * The approved insurer price for (companyId, serviceId), or null when there is no
 * effective list, no matching row, or the row isn't approved yet.
 * `price` is stored as a numeric column (string at runtime) — coerced here.
 */
export async function resolveInsurerPrice(
  db: Db,
  companyId: string,
  serviceId: string
): Promise<number | null> {
  const [eff] = await db
    .select({ id: insurancePriceLists.id })
    .from(insurancePriceLists)
    .where(
      and(eq(insurancePriceLists.companyId, companyId), eq(insurancePriceLists.status, 'effective'))
    )
    .limit(1)
  if (!eff) return null

  const [item] = await db
    .select({ price: insurancePriceListItems.price })
    .from(insurancePriceListItems)
    .where(
      and(
        eq(insurancePriceListItems.priceListId, eff.id),
        eq(insurancePriceListItems.serviceId, serviceId),
        eq(insurancePriceListItems.mappingStatus, 'approved')
      )
    )
    .limit(1)

  if (!item) return null
  const n = Number(item.price)
  return Number.isFinite(n) ? n : null
}
