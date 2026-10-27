/**
 * G03 — what a split payment's list of methods must look like.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (G03) and step-10-handover.md.
 *
 * The same check runs in the route (so a bad request is a 400 with a sentence) and in
 * `recordLegacyPayment` (so no other caller can post a half-valid split), which is why it is a
 * pure function in its own module: the route tests replace `payment-service` wholesale.
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_PAYMENT_SOURCES,
  PaymentInputError,
  parsePaymentSources,
} from '../../src/lib/payment-sources'

describe('parsePaymentSources — a good list', () => {
  it('returns each method with its amount in whole pesewas', () => {
    const parsed = parsePaymentSources([
      { method: 'cash', amount: 30000 },
      { method: 'card', amount: 20000, externalReference: 'POS-77' },
    ])
    expect(parsed).toEqual({
      sources: [
        { method: 'cash', amount: 30000, externalReference: null },
        { method: 'card', amount: 20000, externalReference: 'POS-77' },
      ],
    })
  })

  it('trims the method’s name', () => {
    const parsed = parsePaymentSources([{ method: '  momo ', amount: 100 }])
    expect('sources' in parsed && parsed.sources[0].method).toBe('momo')
  })

  it('treats a reference that is not text as no reference', () => {
    const parsed = parsePaymentSources([{ method: 'cash', amount: 100, externalReference: 42 }])
    expect('sources' in parsed && parsed.sources[0].externalReference).toBeNull()
  })

  it(`accepts up to ${MAX_PAYMENT_SOURCES} methods`, () => {
    const many = Array.from({ length: MAX_PAYMENT_SOURCES }, () => ({ method: 'cash', amount: 1 }))
    expect('sources' in parsePaymentSources(many)).toBe(true)
  })
})

describe('parsePaymentSources — what it refuses', () => {
  it.each([
    ['nothing at all', undefined],
    ['null', null],
    ['an object instead of a list', { method: 'cash', amount: 100 }],
    ['text', 'cash'],
    ['an empty list', []],
  ])('%s', (_what, raw) => {
    expect(parsePaymentSources(raw)).toEqual({
      error: 'sources must list at least one payment method',
    })
  })

  it('more methods than a payment can be split across', () => {
    const tooMany = Array.from({ length: MAX_PAYMENT_SOURCES + 1 }, () => ({
      method: 'cash',
      amount: 1,
    }))
    expect(parsePaymentSources(tooMany)).toEqual({
      error: `a payment can be split across at most ${MAX_PAYMENT_SOURCES} methods`,
    })
  })

  it.each([
    ['an entry that is not an object', [null]],
    ['a number in place of an entry', [100]],
    ['a missing method', [{ amount: 100 }]],
    ['a blank method', [{ method: '   ', amount: 100 }]],
    ['a method that is not text', [{ method: 7, amount: 100 }]],
  ])('%s', (_what, raw) => {
    expect(parsePaymentSources(raw)).toEqual({ error: 'each payment needs a method' })
  })

  it.each([
    ['an amount of nothing', 0],
    ['a negative amount', -100],
  ])('%s', (_what, amount) => {
    expect(parsePaymentSources([{ method: 'cash', amount }])).toEqual({
      error: 'each payment amount must be positive',
    })
  })

  it.each([
    ['a fraction of a pesewa', 100.5],
    ['text', '100'],
    ['not a number', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
    ['a missing amount', undefined],
    ['null', null],
  ])('an amount that is %s', (_what, amount) => {
    expect(parsePaymentSources([{ method: 'cash', amount }])).toEqual({
      error: 'each payment amount must be a whole number of pesewas',
    })
  })

  it('reports the first problem in the list, not a later one', () => {
    expect(
      parsePaymentSources([
        { method: 'cash', amount: 100 },
        { method: '', amount: 0 },
        { method: 'card', amount: 1.5 },
      ])
    ).toEqual({ error: 'each payment needs a method' })
  })
})

describe('PaymentInputError', () => {
  it('is an Error carrying a sentence a person can be shown', () => {
    const err = new PaymentInputError('unknown payment method "banana"')
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('unknown payment method "banana"')
    expect(err.name).toBe('PaymentInputError')
  })
})
