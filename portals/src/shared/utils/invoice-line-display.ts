/**
 * How an invoice or estimate line's price reads.
 *
 * A line billed by the first-unit / additional-unit tariff (G01) stores the FIRST unit's price as
 * `unitPrice`, and bills `unitPrice + additionalUnitPrice × (quantity − 1)` as its `lineSubtotal`.
 * Read as "unit price × quantity" it does not add up (GH₵100.00 × 3 beside GH₵220.00). The
 * further-unit price is not stored on the line, but it is exactly what the subtotal implies.
 */

type PricedLine = {
  quantity: number | string
  unitPrice: number | string
  lineSubtotal?: number | string | null
}

/** The further-unit price (cents) of a stepped line, or null for a line billed flat. */
export function additionalUnitPriceOf(line: PricedLine): number | null {
  const quantity = Number(line.quantity)
  const unitPrice = Number(line.unitPrice)
  if (line.lineSubtotal == null || !(quantity > 1)) return null
  const subtotal = Number(line.lineSubtotal)
  if (!Number.isFinite(subtotal) || subtotal === unitPrice * quantity) return null
  const further = (subtotal - unitPrice) / (quantity - 1)
  return Number.isInteger(further) && further >= 0 ? further : null
}

/** "GH₵100.00 + 2 × GH₵60.00" for a stepped line, "GH₵100.00 × 3" otherwise. */
export function linePriceReading(line: PricedLine, money: (cents: number) => string): string {
  const quantity = Number(line.quantity)
  const unitPrice = Number(line.unitPrice)
  const further = additionalUnitPriceOf(line)
  return further != null
    ? `${money(unitPrice)} + ${quantity - 1} × ${money(further)}`
    : `${money(unitPrice)} × ${quantity}`
}
