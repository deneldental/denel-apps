/**
 * service-tax.ts — resolves a service's effective sales-tax rate from its
 * stacked `taxIds` (build plan R1). Each id points at a `tax_configurations` row
 * (VAT / NHIL / GETFund…); the effective rate is the sum of the selected active
 * taxes. Services with no taxIds fall back to the legacy `taxStatus` behaviour
 * ('standard' → the blended clinic rate, else 0) so existing catalog rows are
 * unchanged.
 */

import { eq } from 'drizzle-orm'
import type { DB } from '../db'
import { taxConfigurations } from '../db/schema'

/** Output/sales taxes that stack onto an invoice line. WHT/CIT are excluded. */
export const SALES_TAX_TYPES = ['VAT', 'NHIL', 'GETFund'] as const

/** id → rate (fraction, e.g. 0.15) for every active tax configuration. */
export async function loadTaxRateMap(db: DB): Promise<Map<string, number>> {
  const rows = await db
    .select({ id: taxConfigurations.id, rate: taxConfigurations.rate })
    .from(taxConfigurations)
    .where(eq(taxConfigurations.isActive, true))
  return new Map(rows.map((r) => [r.id, Number(r.rate) || 0]))
}

/**
 * The line tax rate (as a percentage) for a service. Sums the service's stacked
 * taxes when set; otherwise falls back to the legacy taxStatus/blended rate.
 */
export function serviceTaxRatePct(
  service: { taxIds?: unknown; taxStatus?: string | null },
  taxRateMap: Map<string, number>,
  blendedStandardPct: number
): number {
  const ids = Array.isArray(service.taxIds) ? (service.taxIds as string[]) : []
  if (ids.length > 0) {
    const sum = ids.reduce((acc, id) => acc + (taxRateMap.get(id) ?? 0), 0)
    return sum * 100
  }
  return service.taxStatus === 'standard' ? blendedStandardPct : 0
}
