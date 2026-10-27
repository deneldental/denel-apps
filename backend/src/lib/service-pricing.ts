/**
 * service-pricing.ts — the pricing-matrix resolver (build plan P1).
 *
 * A service prices along two axes: a variant/tier (Simple/Surgical, 1-/2-surface)
 * and quantity-in-scope (whole_mouth/arch/quadrant/tooth/surface/session/unit),
 * plus optional tooth-class pricing (molar/premolar/…). Each priced combination
 * is a `service_prices` row (a "cell"). Given a service + optional variant +
 * optional tooth-class + quantity, this returns the unit price and the matched
 * cell for line tracing. If a service has no cells it falls back to
 * `services.amount` (backward-compatible flat pricing).
 *
 * Internal service codes only — this module never reads `services.cdtCode`.
 */

import { asc, eq } from 'drizzle-orm'
import type { DB } from '../db'
import { applicationScopes, servicePrices, services, toothClasses } from '../db/schema'

export interface ResolvePriceInput {
  serviceId: string
  variantName?: string | null
  toothClassId?: string | null
  quantity?: number | null
}

export interface ResolvedPrice {
  serviceId: string
  name: string
  /** Resolved unit price (matrix cell, else the service's flat `amount`). */
  unitPrice: number
  /**
   * First-unit / additional-unit tariff: the price of each unit after the first, in cents, when the
   * service's application type is billed in steps AND the service has the price — whichever variant
   * is chosen. Null → every unit costs `unitPrice`. 0 is a price (further units free).
   */
  additionalUnitPrice: number | null
  /** Quantity after scope rules (single-scope forces 1; multi caps at maxQuantity). */
  quantity: number
  /** Guided range for the resolved cell/service, if any. */
  priceMin: number | null
  priceMax: number | null
  taxStatus: string
  discountEligible: boolean
  /** The matched cell, for invoice-line tracing. Null when flat-priced. */
  cell: {
    id: string
    serviceCode: string | null
    variantName: string | null
    toothClassId: string | null
  } | null
}

const toNum = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const toNullNum = (v: unknown): number | null => {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Clamp a requested quantity to the service's scope rules.
 * single-mode scopes (whole mouth, session) always bill quantity 1.
 */
function resolveQuantity(
  requested: number | null | undefined,
  scope: { quantityMode: string; maxQuantity: number | null } | null
): number {
  if (!scope || scope.quantityMode === 'single') return 1
  let q = Math.floor(toNum(requested ?? 1))
  if (q < 1) q = 1
  if (scope.maxQuantity != null && q > scope.maxQuantity) q = scope.maxQuantity
  return q
}

/**
 * Pick the matrix cell matching the chosen variant + tooth-class. A null choice
 * matches a null cell dimension, so a flat service (one null/null cell, or none)
 * still resolves. Prefers an exact (variant, class) match, then the widest active
 * cell as a fallback.
 */
function pickCell(
  cells: Array<typeof servicePrices.$inferSelect>,
  variantName: string | null | undefined,
  toothClassId: string | null | undefined
) {
  const active = cells.filter((c) => c.isActive)
  const v = variantName ?? null
  const t = toothClassId ?? null
  // Exact match on both dimensions.
  const exact = active.find((c) => (c.variantName ?? null) === v && (c.toothClassId ?? null) === t)
  if (exact) return exact
  // Variant matches, class unspecified on the cell (class-agnostic variant price).
  const byVariant = active.find((c) => (c.variantName ?? null) === v && c.toothClassId == null)
  if (byVariant) return byVariant
  // Class matches, variant unspecified.
  const byClass = active.find((c) => c.variantName == null && (c.toothClassId ?? null) === t)
  if (byClass) return byClass
  // The single flat cell (both null).
  const flat = active.find((c) => c.variantName == null && c.toothClassId == null)
  return flat ?? null
}

/**
 * Resolve the authoritative unit price for a billable line. Server-side only —
 * never trust a client-supplied price for catalog items.
 */
export async function resolveServicePrice(
  db: DB,
  input: ResolvePriceInput
): Promise<ResolvedPrice | null> {
  const [svc] = await db.select().from(services).where(eq(services.id, input.serviceId)).limit(1)
  if (!svc) return null

  const scope = svc.scopeId
    ? ((
        await db
          .select({
            quantityMode: applicationScopes.quantityMode,
            maxQuantity: applicationScopes.maxQuantity,
            additionalUnitPriceEnabled: applicationScopes.additionalUnitPriceEnabled,
          })
          .from(applicationScopes)
          .where(eq(applicationScopes.id, svc.scopeId))
          .limit(1)
      )[0] ?? null)
    : null

  const cells = await db
    .select()
    .from(servicePrices)
    .where(eq(servicePrices.serviceId, svc.id))
    .orderBy(asc(servicePrices.sortOrder))

  const quantity = resolveQuantity(input.quantity, scope)
  const cell = cells.length > 0 ? pickCell(cells, input.variantName, input.toothClassId) : null

  const unitPrice = cell ? toNum(cell.price) : toNum(svc.amount)
  const priceMin = cell ? toNullNum(cell.priceMin) : toNullNum(svc.priceMin)
  const priceMax = cell ? toNullNum(cell.priceMax) : toNullNum(svc.priceMax)
  // Stepped only when the type's switch is on AND the service has the price; either missing → flat.
  const additionalUnitPrice = scope?.additionalUnitPriceEnabled
    ? toNullNum(svc.additionalUnitPrice)
    : null

  return {
    serviceId: svc.id,
    name: svc.name,
    unitPrice,
    additionalUnitPrice,
    quantity,
    priceMin,
    priceMax,
    taxStatus: svc.taxStatus,
    discountEligible: svc.discountEligible,
    cell: cell
      ? {
          id: cell.id,
          serviceCode: cell.serviceCode ?? svc.serviceCode ?? null,
          variantName: cell.variantName ?? null,
          toothClassId: cell.toothClassId ?? null,
        }
      : null,
  }
}

export interface ServiceMatrix {
  service: typeof services.$inferSelect
  scope: typeof applicationScopes.$inferSelect | null
  cells: Array<typeof servicePrices.$inferSelect>
  /** Distinct variant names present in the cells, in sort order. */
  variants: string[]
  /** Tooth classes referenced by the cells. */
  toothClasses: Array<typeof toothClasses.$inferSelect>
}

/**
 * Load a service's full matrix (scope + cells + the variant/class dimensions in
 * play) for the Services editor and the estimate/checkout pickers.
 */
export async function getServiceMatrix(db: DB, serviceId: string): Promise<ServiceMatrix | null> {
  const [svc] = await db.select().from(services).where(eq(services.id, serviceId)).limit(1)
  if (!svc) return null

  const [scope] = svc.scopeId
    ? await db
        .select()
        .from(applicationScopes)
        .where(eq(applicationScopes.id, svc.scopeId))
        .limit(1)
    : [null]

  const cells = await db
    .select()
    .from(servicePrices)
    .where(eq(servicePrices.serviceId, serviceId))
    .orderBy(asc(servicePrices.sortOrder))

  const variants = [...new Set(cells.map((c) => c.variantName).filter((v): v is string => !!v))]
  const classIds = [...new Set(cells.map((c) => c.toothClassId).filter((v): v is string => !!v))]
  const classes = classIds.length
    ? await db.select().from(toothClasses).orderBy(asc(toothClasses.sortOrder))
    : []

  return {
    service: svc,
    scope: scope ?? null,
    cells,
    variants,
    toothClasses: classes.filter((c) => classIds.includes(c.id)),
  }
}

/** Generate the next internal service code (SVC-000123). Not a CDT code. */
export async function nextServiceCode(db: DB): Promise<string> {
  const rows = await db.select({ code: services.serviceCode }).from(services)
  let max = 0
  for (const r of rows) {
    const m = /^SVC-(\d+)$/.exec(r.code ?? '')
    if (m) {
      const n = Number.parseInt(m[1], 10)
      if (n > max) max = n
    }
  }
  return `SVC-${String(max + 1).padStart(6, '0')}`
}
