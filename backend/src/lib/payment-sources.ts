/**
 * payment-sources.ts — what the methods of a split payment must look like (G03).
 *
 * One payment may be split across several methods, e.g. part cash and part card: a list of
 * `{ method, amount }` entries called `sources`. `parsePaymentSources` is the single check for that
 * list. The route runs it first, so a bad request is a 400 with a sentence; `recordLegacyPayment`
 * runs it again, so no other caller can post a half-valid split. It is a pure function in its own
 * module (and not in payment-service) because the route tests replace payment-service wholesale.
 */

/** A payment is split across more methods than a clinic has; a larger list is a mistake. */
export const MAX_PAYMENT_SOURCES = 20

/** `payments.amount` is a 32-bit integer of pesewas: the most one payment can hold (checked when a
 *  payment is drafted, in `createDraftPayment`, so every route that takes an amount is covered). */
export const MAX_PAYMENT_AMOUNT = 2_147_483_647

/** One method and the part of the payment it paid, in whole pesewas. */
export type ParsedPaymentSource = {
  method: string
  amount: number
  externalReference: string | null
}

/**
 * A refusal the person who sent the payment can fix, so its message is shown to them as written.
 * Anything else that goes wrong while recording a payment is ours, and is answered with a generic
 * error.
 */
export class PaymentInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaymentInputError'
  }
}

export function parsePaymentSources(
  raw: unknown
): { sources: ParsedPaymentSource[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: 'sources must list at least one payment method' }
  }
  if (raw.length > MAX_PAYMENT_SOURCES) {
    return { error: `a payment can be split across at most ${MAX_PAYMENT_SOURCES} methods` }
  }

  const sources: ParsedPaymentSource[] = []
  for (const entry of raw) {
    const item = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    const method = typeof item.method === 'string' ? item.method.trim() : ''
    if (!method) return { error: 'each payment needs a method' }

    const amount = item.amount
    if (typeof amount !== 'number' || !Number.isInteger(amount)) {
      return { error: 'each payment amount must be a whole number of pesewas' }
    }
    if (amount <= 0) return { error: 'each payment amount must be positive' }

    sources.push({
      method,
      amount,
      externalReference: typeof item.externalReference === 'string' ? item.externalReference : null,
    })
  }
  return { sources }
}
