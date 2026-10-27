/**
 * The decisions a payment receipt makes, shared by the on-screen slip
 * (`receipt-view-dialog.tsx`) and the printed one (`receipt.ts`), which draw from the same data.
 */

/** The fields of an allocation that exist only when there is a real invoice behind it. */
interface InvoiceBacked {
  invoiceTotal?: number | null
  invoiceSubtotal?: number | null
}

/**
 * True when at least one allocation is a real invoice, so Subtotal / Taxes / Total mean something.
 * A one-time payment that pays no invoice is itemised from what it recorded (G04) and carries no
 * invoice figures; summing those nulls would print an invoice of GHS 0.00 above a payment that
 * was not for an invoice.
 */
export function hasInvoiceTotals(allocations: InvoiceBacked[] | undefined): boolean {
  return (allocations ?? []).some((a) => a.invoiceSubtotal != null || a.invoiceTotal != null)
}

/**
 * The words that mark a receipt as no longer the whole truth: every payment on it has been
 * reversed, or only some of the methods of a split have been. Null for a payment in force (and
 * for a server that does not report a status).
 */
export function reversalBanner(status: string | undefined): string | null {
  if (status === 'reversed') return 'REVERSED'
  if (status === 'partly_reversed') return 'PART REVERSED'
  return null
}

/** Marks a single method that has been reversed, wherever its name is printed. */
export function methodStatusSuffix(status: string | undefined): string {
  return status === 'reversed' ? ' (reversed)' : ''
}

/**
 * Makes text safe to put inside an HTML document that is built as a string. The printed receipt
 * is such a document, and it carries text people typed: patient names, notes, the names recorded
 * on a payment's items, a method's reference.
 */
export function escapeHtml(text: string | null | undefined): string {
  return (text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
