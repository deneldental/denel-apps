import { formatCurrency, inputToCents } from '@/shared/utils/currency'

/**
 * One method of a payment that may be split across several, e.g. part cash and part card.
 * `amount` is what the cashier typed, in cedis; it becomes pesewas when the payment is recorded.
 */
export interface PaymentSourceRow {
  key: string
  method: string
  amount: string
}

/** What the rows add up to, in pesewas. A box that is empty or not a number counts as nothing. */
export function paymentSourcesTotalCents(rows: PaymentSourceRow[]): number {
  return rows.reduce((sum, row) => sum + inputToCents(row.amount), 0)
}

/**
 * How far the methods are from covering `totalCents`, in pesewas: positive while some is still to
 * be placed, zero when it all is, negative when the methods add up to more than the total.
 */
export function paymentSourcesBalance(rows: PaymentSourceRow[], totalCents: number): number {
  return totalCents - paymentSourcesTotalCents(rows)
}

/** The words shown under the rows for a balance from `paymentSourcesBalance`. */
export function paymentSourcesBalanceLabel(balanceCents: number): string {
  if (balanceCents === 0) return 'Fully allocated'
  return balanceCents > 0
    ? `${formatCurrency(balanceCents)} remaining`
    : `${formatCurrency(-balanceCents)} over`
}
