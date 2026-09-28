import { describe, expect, it } from 'vitest'
import { decideFunding, type TreatmentFundingFacts } from '../../src/lib/treatment-funding'

// Money fields are integer CENTS, matching the `invoices` columns these facts
// are read from (migration 0209). 100_000 == GH₵1,000.00.

/** An issued, wholly unpaid estimate — the case the gate exists to block. */
const unfunded: TreatmentFundingFacts = {
  invoiceExists: true,
  invoiceNumber: 'INV-2026-00001',
  status: 'issued',
  total: 100000,
  paidAmount: 0,
  balance: 100000,
  hasActivePaymentPlan: false,
  patientHasInsurance: false,
}

const facts = (over: Partial<TreatmentFundingFacts> = {}): TreatmentFundingFacts => ({
  ...unfunded,
  ...over,
})

describe('decideFunding — blocks', () => {
  it('blocks an issued, unpaid estimate', () => {
    const r = decideFunding(unfunded)
    expect(r.funded).toBe(false)
    expect(r.reason).toBe('unfunded')
  })

  it('names the outstanding amount so reception knows what to collect', () => {
    expect(decideFunding(unfunded).detail).toContain('1,000.00')
  })

  it('blocks a voided estimate even when it was partly paid', () => {
    const r = decideFunding(facts({ status: 'void', paidAmount: 40000, balance: 60000 }))
    expect(r.funded).toBe(false)
    expect(r.reason).toBe('voided')
  })

  it('blocks when no invoice exists at all', () => {
    const r = decideFunding(facts({ invoiceExists: false, invoiceNumber: null, status: null }))
    expect(r.funded).toBe(false)
    expect(r.reason).toBe('missing_invoice')
  })

  it('blocks a draft estimate — reception has not committed the charge', () => {
    expect(decideFunding(facts({ status: 'draft' })).funded).toBe(false)
  })
})

describe('decideFunding — funds', () => {
  it('funds a paid invoice', () => {
    const r = decideFunding(facts({ status: 'paid', paidAmount: 100000, balance: 0 }))
    expect(r.funded).toBe(true)
    expect(r.reason).toBe('paid')
  })

  it('funds a zero balance whose status has not caught up', () => {
    const r = decideFunding(facts({ status: 'issued', paidAmount: 100000, balance: 0 }))
    expect(r.funded).toBe(true)
    expect(r.reason).toBe('settled')
  })

  it('funds a zero-total estimate — nothing to collect', () => {
    const r = decideFunding(facts({ total: 0, balance: 0 }))
    expect(r.funded).toBe(true)
  })

  it('funds on any deposit, however small', () => {
    const r = decideFunding(facts({ paidAmount: 100, balance: 99900 }))
    expect(r.funded).toBe(true)
    expect(r.reason).toBe('deposit')
  })

  it('reports both the deposit and what is still owed', () => {
    const d = decideFunding(facts({ paidAmount: 20000, balance: 80000 })).detail
    expect(d).toContain('200.00')
    expect(d).toContain('800.00')
  })

  it('funds an unpaid estimate covered by a payment plan', () => {
    const r = decideFunding(facts({ hasActivePaymentPlan: true }))
    expect(r.funded).toBe(true)
    expect(r.reason).toBe('payment_plan')
  })

  it('funds an insurance-covered patient', () => {
    const r = decideFunding(facts({ patientHasInsurance: true }))
    expect(r.funded).toBe(true)
    expect(r.reason).toBe('insurance')
  })

  it('funds an insured patient even with no invoice — the clinic is not billing them', () => {
    const r = decideFunding(
      facts({ patientHasInsurance: true, invoiceExists: false, invoiceNumber: null })
    )
    expect(r.funded).toBe(true)
    expect(r.reason).toBe('insurance')
  })

  it('funds an insured patient on a voided estimate', () => {
    const r = decideFunding(facts({ patientHasInsurance: true, status: 'void' }))
    expect(r.funded).toBe(true)
  })
})

describe('decideFunding — order independence', () => {
  // The rule reads current state, never a sequence. Deposit-then-plan and
  // plan-then-deposit must be indistinguishable; if they ever diverge, someone
  // has reintroduced ordering.
  it('gives the same verdict whichever arrived first', () => {
    const depositThenPlan = decideFunding(facts({ paidAmount: 20000, balance: 80000 }))
    const planThenDeposit = decideFunding(
      facts({ paidAmount: 20000, balance: 80000, hasActivePaymentPlan: true })
    )
    expect(depositThenPlan.funded).toBe(planThenDeposit.funded)
    expect(depositThenPlan.funded).toBe(true)
  })

  it('a plan alone and a deposit alone both fund', () => {
    expect(decideFunding(facts({ hasActivePaymentPlan: true })).funded).toBe(true)
    expect(decideFunding(facts({ paidAmount: 5000, balance: 95000 })).funded).toBe(true)
  })
})

describe('decideFunding — reported amounts', () => {
  it('echoes the invoice figures back for the caller to render', () => {
    const r = decideFunding(facts({ total: 100000, paidAmount: 25000, balance: 75000 }))
    expect(r).toMatchObject({
      invoiceNumber: 'INV-2026-00001',
      total: 100000,
      paidAmount: 25000,
      balance: 75000,
    })
  })

  it('treats a negative balance (overpayment) as funded', () => {
    const r = decideFunding(facts({ paidAmount: 120000, balance: -20000 }))
    expect(r.funded).toBe(true)
    expect(r.reason).toBe('settled')
  })
})
