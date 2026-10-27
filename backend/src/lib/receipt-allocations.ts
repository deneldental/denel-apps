/**
 * Receipt line items for a one-time payment (G04).
 *
 * `GET /api/payments/:id/receipt` normally builds its itemised table from the invoice lines of the
 * invoices a payment was allocated to. A payment recorded by the one-time payment sheet is allocated
 * to no invoice (it posts as unapplied patient credit), so it has no invoice lines; the only
 * itemisation it carries is `payments.treatments`, the list the sheet writes. Its schema comment
 * marks that column deprecated for new code, but the sheet still fills it and nothing else holds a
 * one-time payment's items, so the receipt reads it here instead of dropping to a single "Service:"
 * line.
 *
 * The result has the shape of an invoice-backed allocation, so the receipt's existing table renders
 * it unchanged, but every invoice-shaped field is empty: there is no invoice, and the receipt must
 * not print an invoice number, subtotal, tax or balance that does not exist.
 */

export interface ReceiptLineItem {
  name: string
  cost: number
}

export interface SyntheticReceiptAllocation {
  invoiceNumber: string
  invoiceTotal: null
  invoiceSubtotal: null
  invoiceTaxTotal: null
  amountApplied: number
  remainingBalance: null
  status: null
  treatments: string[]
  items: ReceiptLineItem[]
}

export function buildTreatmentFallbackAllocation(
  treatments: unknown,
  amountApplied: number
): SyntheticReceiptAllocation | null {
  if (!Array.isArray(treatments)) return null

  const items: ReceiptLineItem[] = []
  for (const raw of treatments) {
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as { name?: unknown; amount?: unknown }
    const name = typeof entry.name === 'string' ? entry.name.trim() : ''
    const cost = Number(entry.amount)
    if (!name || entry.amount == null || !Number.isFinite(cost)) continue
    items.push({ name, cost })
  }

  if (items.length === 0) return null

  return {
    invoiceNumber: '',
    invoiceTotal: null,
    invoiceSubtotal: null,
    invoiceTaxTotal: null,
    amountApplied,
    remainingBalance: null,
    status: null,
    treatments: items.map((i) => i.name),
    items,
  }
}
