/**
 * G03 — the arithmetic behind the one-time payment sheet's list of payment methods.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (G03) and step-10-handover.md.
 *
 * The rows hold what the cashier typed, in cedis. The sheet will only record a payment whose
 * methods add up to the services EXACTLY, in pesewas, so the sum has to be exact (no floating-point
 * drift on amounts like 0.10 + 0.20) and the words under the rows have to say how far off it is.
 */
import { describe, expect, it } from 'vitest'
import {
  type PaymentSourceRow,
  paymentSourcesBalance,
  paymentSourcesBalanceLabel,
  paymentSourcesTotalCents,
} from '@/features/payments/payment-sources'
import { formatCurrency } from '@/shared/utils/currency'

const row = (method: string, amount: string): PaymentSourceRow => ({
  key: `${method}-1`,
  method,
  amount,
})

describe('paymentSourcesTotalCents', () => {
  it('adds up what was typed, in pesewas', () => {
    expect(paymentSourcesTotalCents([row('cash', '300'), row('card', '200.50')])).toBe(50050)
  })

  it('is exact for amounts that floating point cannot hold', () => {
    expect(paymentSourcesTotalCents([row('cash', '0.10'), row('card', '0.20')])).toBe(30)
  })

  it('counts a box that is empty or not a number as nothing', () => {
    expect(
      paymentSourcesTotalCents([row('cash', '120'), row('card', ''), row('momo', 'abc')])
    ).toBe(12000)
  })

  it('is nothing for no rows', () => {
    expect(paymentSourcesTotalCents([])).toBe(0)
  })
})

describe('paymentSourcesBalance', () => {
  const rows = [row('cash', '100'), row('card', '50')]

  it('is positive while some of the total is still to be placed', () => {
    expect(paymentSourcesBalance(rows, 20000)).toBe(5000)
  })

  it('is zero when the methods cover the total exactly', () => {
    expect(paymentSourcesBalance(rows, 15000)).toBe(0)
  })

  it('is negative when the methods add up to more than the total', () => {
    expect(paymentSourcesBalance(rows, 12000)).toBe(-3000)
  })
})

describe('paymentSourcesBalanceLabel', () => {
  it('says when everything is placed', () => {
    expect(paymentSourcesBalanceLabel(0)).toBe('Fully allocated')
  })

  it('says how much is still to be placed', () => {
    expect(paymentSourcesBalanceLabel(5000)).toBe(`${formatCurrency(5000)} remaining`)
  })

  it('says how much is over', () => {
    expect(paymentSourcesBalanceLabel(-3000)).toBe(`${formatCurrency(3000)} over`)
  })
})
