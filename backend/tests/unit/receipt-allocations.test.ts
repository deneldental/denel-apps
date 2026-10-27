/**
 * G04 — itemised receipts for one-time payments that pay no invoice.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (G04) and step-10-handover.md.
 *
 * `GET /api/payments/:id/receipt` normally builds its itemised table from the invoice lines of the
 * invoices a payment was allocated to. A one-time payment is allocated to none (it posts as patient
 * credit), so it has no invoice lines; the only itemisation it carries is `payments.treatments`, the
 * list the one-time sheet writes. `buildTreatmentFallbackAllocation` turns that list into the same
 * shape the invoice path produces, so the receipt can show its items, WITHOUT inventing an invoice:
 * every invoice-shaped field of the result is empty.
 */
import { describe, expect, it } from 'vitest'
import { buildTreatmentFallbackAllocation } from '../../src/lib/receipt-allocations'

describe('buildTreatmentFallbackAllocation', () => {
  it('builds the items from the treatments the payment recorded', () => {
    const treatments = [
      { treatmentId: 't1', name: 'Scaling and Polishing', amount: 15000 },
      { treatmentId: 't2', name: 'Fluoride Treatment', amount: 5000 },
    ]

    const result = buildTreatmentFallbackAllocation(treatments, 20000)

    expect(result?.items).toEqual([
      { name: 'Scaling and Polishing', cost: 15000 },
      { name: 'Fluoride Treatment', cost: 5000 },
    ])
    expect(result?.treatments).toEqual(['Scaling and Polishing', 'Fluoride Treatment'])
    expect(result?.amountApplied).toBe(20000)
  })

  it('leaves every invoice-shaped field empty, since there is no invoice', () => {
    const result = buildTreatmentFallbackAllocation([{ name: 'X', amount: 100 }], 100)

    expect(result).toMatchObject({
      invoiceNumber: '',
      invoiceTotal: null,
      invoiceSubtotal: null,
      invoiceTaxTotal: null,
      remainingBalance: null,
      status: null,
    })
  })

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['text', 'bad'],
    ['an object', { name: 'X', amount: 100 }],
    ['an empty list', []],
  ])('is nothing for %s', (_what, treatments) => {
    expect(buildTreatmentFallbackAllocation(treatments, 1000)).toBeNull()
  })

  it('keeps only the entries that have a name and an amount', () => {
    const treatments = [
      { name: '', amount: 500 },
      { name: '   ', amount: 500 },
      { name: 'No amount' },
      { name: 'Null amount', amount: null },
      { name: 'Bad amount', amount: Number.NaN },
      null,
      7,
      'text',
      { name: 'Keep Me', amount: 1200 },
    ]

    const result = buildTreatmentFallbackAllocation(treatments, 1200)

    expect(result?.items).toEqual([{ name: 'Keep Me', cost: 1200 }])
  })

  it('is nothing when no entry is usable', () => {
    expect(buildTreatmentFallbackAllocation([{ name: '', amount: 1 }, null], 100)).toBeNull()
  })

  it('trims names and reads an amount that arrives as text', () => {
    const result = buildTreatmentFallbackAllocation([{ name: '  Crown  ', amount: '9000' }], 9000)

    expect(result?.items).toEqual([{ name: 'Crown', cost: 9000 }])
  })
})
