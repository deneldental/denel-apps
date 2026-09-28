import { Money } from '@denel/utils'
import { describe, expect, it } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// R1 regression suite — see code-report-v1.md findings C1, C2, H1, H5, L1–L5.
//
// Several `describe` blocks below are written to go RED against the pre-R1
// `Money` implementation (the "reproduced red?" gate) and GREEN after the
// BigInt rewrite. They are tagged with the finding id.
// ─────────────────────────────────────────────────────────────────────────────

describe('Money — construction', () => {
  it('parses decimal strings', () => {
    expect(Money.fromString('1234.56').toString()).toBe('1234.56')
    expect(Money.fromString('0').toString()).toBe('0.00')
    expect(Money.fromString('-5.10').toString()).toBe('-5.10')
  })

  it('parses numbers with banker rounding', () => {
    expect(Money.fromNumber(0.125).toString()).toBe('0.12') // round half to even (down)
    expect(Money.fromNumber(0.135).toString()).toBe('0.14') // round half to even (up)
    expect(Money.fromNumber(1.005).toString()).toBe('1.00')
  })

  it('accepts strings and numbers from DB (Money.fromDb)', () => {
    expect(Money.fromDb('9999').toString()).toBe('99.99')
    expect(Money.fromDb(9999).toString()).toBe('99.99')
    expect(Money.fromDb(null).toString()).toBe('0.00')
  })

  it('rejects invalid strings', () => {
    expect(() => Money.fromString('')).toThrow()
    expect(() => Money.fromString('abc')).toThrow()
    expect(() => Money.fromString('1.2.3')).toThrow()
  })

  // L5 — negative-zero must normalise to a clean 0.00, not "-0.00".
  it('normalises negative zero', () => {
    expect(Money.fromString('-0').toString()).toBe('0.00')
    expect(Money.fromString('-0.00').toString()).toBe('0.00')
    expect(Money.fromString('-0').isZero()).toBe(true)
  })
})

// H5 — fromString must ROUND a 3rd+ decimal digit, not silently truncate it.
describe('Money.fromString — sub-cent rounding [H5]', () => {
  it('rounds, does not truncate, the third decimal digit', () => {
    expect(Money.fromString('1.006').toString()).toBe('1.01') // truncate gave 1.00
    expect(Money.fromString('1.004').toString()).toBe('1.00')
    expect(Money.fromString('9.999').toString()).toBe('10.00') // truncate gave 9.99
  })

  it('uses banker’s rounding on an exact half-cent', () => {
    expect(Money.fromString('1.005').toString()).toBe('1.00') // 0 cent is even
    expect(Money.fromString('1.015').toString()).toBe('1.02') // 1 cent is odd → up
    expect(Money.fromString('1.025').toString()).toBe('1.02') // 2 cent is even
  })

  it('rounds the magnitude for negative inputs symmetrically', () => {
    expect(Money.fromString('-1.006').toString()).toBe('-1.01')
    expect(Money.fromString('-1.015').toString()).toBe('-1.02')
  })
})

describe('Money — add / sub / sum are exact', () => {
  it('0.1 + 0.2 = 0.30 (the canonical float gotcha)', () => {
    const sum = Money.fromString('0.10').add(Money.fromString('0.20'))
    expect(sum.toString()).toBe('0.30')
    expect(sum.toNumber()).toBe(0.3)
  })

  it('accumulating 100 × 0.01 = 1.00 — no drift', () => {
    let total = Money.zero()
    for (let i = 0; i < 100; i++) total = total.add(Money.fromString('0.01'))
    expect(total.toString()).toBe('1.00')
  })

  it('subtract works', () => {
    expect(Money.fromString('10.00').sub(Money.fromString('2.50')).toString()).toBe('7.50')
  })

  it('sum of a large series is exact', () => {
    const values = Array.from({ length: 1000 }, () => Money.fromString('0.07'))
    expect(Money.sum(values).toString()).toBe('70.00')
  })
})

// C1 — mul / div / percent must be exact (BigInt), not float-rounded.
describe('Money — mul / div / percent are exact [C1]', () => {
  it('percent uses the exact decimal rate, not its float approximation', () => {
    // 0.10 GHS × 15% = 1.5 cents → banker’s → 2 cents.  The float path
    // (0.15 ≈ 0.149999…) computed 1.4999… and wrongly produced 1 cent.
    expect(Money.fromString('0.10').percent(15).toString()).toBe('0.02')
    // 0.50 GHS × 15% = 7.5 cents → banker’s (7 is odd) → 8 cents.
    expect(Money.fromString('0.50').percent(15).toString()).toBe('0.08')
  })

  it('percent — spec §6.1 worked example', () => {
    // 1500.00 endodontics line, 10% discount → 150.00
    expect(Money.fromString('1500.00').percent(10).toString()).toBe('150.00')
    // 1350.00 after discount, 12.5% VAT → 168.75
    expect(Money.fromString('1350.00').percent(12.5).toString()).toBe('168.75')
  })

  it('percent — line-level rounding (spec §11.1)', () => {
    // 1499.95 × 12.5% = 187.49375 → 187.49 (banker’s, below .5)
    expect(Money.fromString('1499.95').percent(12.5).toString()).toBe('187.49')
  })

  it('mul by an integer quantity is exact', () => {
    expect(Money.fromString('250.00').mul(2).toString()).toBe('500.00')
    expect(Money.fromString('333.33').mul(3).toString()).toBe('999.99')
  })

  it('mul by a fractional scalar rounds the cent exactly', () => {
    // 0.03 × 0.5 = 1.5 cents → banker’s (1 odd) → 2 cents
    expect(Money.fromString('0.03').mul(0.5).toString()).toBe('0.02')
    // 0.01 × 0.5 = 0.5 cents → banker’s (0 even) → 0 cents
    expect(Money.fromString('0.01').mul(0.5).toString()).toBe('0.00')
  })

  it('div rounds to the nearest cent', () => {
    expect(Money.fromString('10.00').div(3).toString()).toBe('3.33')
    expect(Money.fromString('10.00').div(8).toString()).toBe('1.25')
    expect(Money.fromString('1.00').div(3).toString()).toBe('0.33')
  })

  it('div by zero throws', () => {
    expect(() => Money.fromString('10.00').div(0)).toThrow()
  })

  it('mul / div reject a non-finite scalar', () => {
    expect(() => Money.fromString('1.00').mul(Number.NaN)).toThrow()
    expect(() => Money.fromString('1.00').div(Number.POSITIVE_INFINITY)).toThrow()
  })
})

// H1 — Money.proportion: exact ratio allocation, replacing toNumber()/toNumber().
describe('Money.proportion — exact ratio allocation [H1]', () => {
  it('allocates a proportional share exactly', () => {
    // 40% of a 500.00 commission line = 200.00
    const paid = Money.fromString('400.00')
    const total = Money.fromString('1000.00')
    expect(Money.fromString('500.00').proportion(paid, total).toString()).toBe('200.00')
  })

  it('rounds the proportional share to the cent (banker’s)', () => {
    // 1/3 of 100.00 = 33.333… → 33.33
    expect(
      Money.fromString('100.00').proportion(Money.fromString('1'), Money.fromString('3')).toString()
    ).toBe('33.33')
  })

  it('proportional tax reversal — 25% of 168.75 tax = 42.19', () => {
    // credit 379.69 of a 1518.75 invoice → fraction 0.25 → 168.75 × 0.25 = 42.1875 → 42.19
    const tax = Money.fromString('168.75')
    const credit = Money.fromString('379.6875')
    const invoiceTotal = Money.fromString('1518.75')
    // proportion takes the credit/total ratio off the tax
    expect(tax.proportion(credit, invoiceTotal).toString()).toBe('42.19')
  })

  it('proportion by zero denominator throws', () => {
    expect(() => Money.fromString('10.00').proportion('5', '0')).toThrow()
  })
})

// C2 — rounding modes must be correct for NEGATIVE values.
describe('Money — rounding modes on negatives [C2]', () => {
  it('half-up rounds a negative half AWAY from zero', () => {
    // -0.005 → -0.5 cents → half-up (away from zero) → -1 cent
    expect(Money.fromNumber(-0.005, 'half-up').toString()).toBe('-0.01')
    expect(Money.fromNumber(0.005, 'half-up').toString()).toBe('0.01')
  })

  it('half-down rounds a negative half TOWARD zero', () => {
    // -0.025 → -2.5 cents → half-down (toward zero) → -2 cents
    expect(Money.fromNumber(-0.025, 'half-down').toString()).toBe('-0.02')
    expect(Money.fromNumber(0.025, 'half-down').toString()).toBe('0.02')
  })

  it('half-even is symmetric on negatives', () => {
    expect(Money.fromNumber(-0.005, 'half-even').toString()).toBe('0.00') // 0 even
    expect(Money.fromNumber(-0.015, 'half-even').toString()).toBe('-0.02') // 2 even
    expect(Money.fromNumber(0.005, 'half-even').toString()).toBe('0.00')
    expect(Money.fromNumber(0.015, 'half-even').toString()).toBe('0.02')
  })

  it('floor rounds toward -infinity, ceil toward +infinity', () => {
    expect(Money.fromNumber(-0.011, 'floor').toString()).toBe('-0.02')
    expect(Money.fromNumber(-0.011, 'ceil').toString()).toBe('-0.01')
    expect(Money.fromNumber(0.011, 'floor').toString()).toBe('0.01')
    expect(Money.fromNumber(0.011, 'ceil').toString()).toBe('0.02')
  })

  it('mul on a negative amount keeps the sign and rounds the magnitude', () => {
    expect(Money.fromString('-0.10').percent(15).toString()).toBe('-0.02')
  })
})

// L4 — fromCents must reject a fractional number rather than silently trunc.
describe('Money.fromCents — integer guard [L4]', () => {
  it('accepts an integer cent count', () => {
    expect(Money.fromCents(15075).toString()).toBe('150.75')
    expect(Money.fromCents(0n).toString()).toBe('0.00')
  })

  it('throws on a fractional cent count instead of truncating', () => {
    expect(() => Money.fromCents(150.7)).toThrow()
  })
})

// L3 — distribute must spread the remainder one cent per slice.
describe('Money.distribute — remainder spreading [L3]', () => {
  it('100.00 / 3 → first slice absorbs the leftover cent', () => {
    const parts = Money.fromString('100.00').distribute(3)
    expect(parts.map((p) => p.toString())).toEqual(['33.34', '33.33', '33.33'])
    expect(Money.sum(parts).toString()).toBe('100.00')
  })

  it('0.07 / 11 → seven 0.01 slices and four 0.00, not ten zeros + 0.07', () => {
    const parts = Money.fromString('0.07').distribute(11)
    expect(parts.slice(0, 7).every((p) => p.toString() === '0.01')).toBe(true)
    expect(parts.slice(7).every((p) => p.toString() === '0.00')).toBe(true)
    expect(Money.sum(parts).toString()).toBe('0.07')
  })

  it('cleanly divisible totals split evenly', () => {
    const parts = Money.fromString('6000.00').distribute(12)
    expect(parts.every((p) => p.toString() === '500.00')).toBe(true)
    expect(Money.sum(parts).toString()).toBe('6000.00')
  })

  it('sum of distributed parts equals total for any size', () => {
    for (const total of ['1.00', '12345.67', '0.07', '999.99', '5500.00']) {
      for (const parts of [2, 3, 5, 7, 11]) {
        const split = Money.fromString(total).distribute(parts)
        expect(Money.sum(split).toString()).toBe(Money.fromString(total).toString())
      }
    }
  })

  it('rejects a non-positive or non-integer part count', () => {
    expect(() => Money.fromString('1.00').distribute(0)).toThrow()
    expect(() => Money.fromString('1.00').distribute(-1)).toThrow()
    expect(() => Money.fromString('1.00').distribute(2.5)).toThrow()
  })
})

describe('Money — comparison', () => {
  it('cmp / gt / lt / eq work', () => {
    const a = Money.fromString('10.00')
    const b = Money.fromString('20.00')
    expect(a.lt(b)).toBe(true)
    expect(b.gt(a)).toBe(true)
    expect(a.eq(Money.fromString('10'))).toBe(true)
    expect(a.cmp(b)).toBe(-1)
    expect(b.cmp(a)).toBe(1)
    expect(a.cmp(Money.fromString('10.00'))).toBe(0)
  })

  it('zero, negative, positive predicates', () => {
    expect(Money.zero().isZero()).toBe(true)
    expect(Money.fromString('-1').isNegative()).toBe(true)
    expect(Money.fromString('1').isPositive()).toBe(true)
  })
})

describe('Money — DB round-trip', () => {
  it('toDbValue produces an integer (cents) the DB can store', () => {
    expect(Money.fromString('1234.56').toDbValue()).toBe(123456)
    expect(Money.fromString('0').toDbValue()).toBe(0)
    expect(Money.fromString('-5.10').toDbValue()).toBe(-510)
  })

  // L1 — toNumber is exact only below ~2^53 cents; document, don't over-claim.
  it('toNumber is exact for clinic-scale balances (below 2^53 cents)', () => {
    expect(Money.fromString('99999999999.99').toNumber()).toBe(99999999999.99)
    expect(Money.fromString('1518.75').toNumber()).toBe(1518.75)
  })

  it('fromDb rejects a decimal string rather than silently truncating', () => {
    expect(() => Money.fromDb('150.50')).toThrow(/integer cent count/)
    expect(Money.fromDb('15050').toString()).toBe('150.50')
    expect(Money.fromDb('-15050').toString()).toBe('-150.50')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// `Money.from` is the coercion behind every arithmetic method, and it had NO
// coverage — which is how it kept treating a number as CEDIS after migration
// 0209 turned every money column into integer CENTS.
// ─────────────────────────────────────────────────────────────────────────────
describe('Money.from — the cents contract', () => {
  it('reads a plain number as CENTS, not cedis', () => {
    expect(Money.from(15050).toString()).toBe('150.50')
    expect(Money.from(1).toString()).toBe('0.01')
    expect(Money.from(0).toString()).toBe('0.00')
    expect(Money.from(-15050).toString()).toBe('-150.50')
  })

  it('reads a string as a CENT count', () => {
    expect(Money.from('15050').toString()).toBe('150.50')
  })

  it('passes a Money through untouched', () => {
    const m = Money.fromString('12.34')
    expect(Money.from(m)).toBe(m)
  })

  it('reads a bigint as cents', () => {
    expect(Money.from(9007199254740993n).toCents()).toBe(9007199254740993n)
  })

  it('throws on a non-integer rather than quietly scaling it', () => {
    expect(() => Money.from(150.5)).toThrow(/integer cent count/)
    expect(() => Money.from(0.1)).toThrow(/Money.fromNumber/)
  })

  it('Money.fromNumber remains the explicit CEDIS entry point', () => {
    expect(Money.fromNumber(150.5).toString()).toBe('150.50')
    expect(Money.fromNumber(150.5).toDbValue()).toBe(15050)
  })

  it('arithmetic against raw DB numbers stays in cents', () => {
    // `add`/`sub`/`eq` all coerce through `Money.from`.
    const balance = Money.fromDb(15050) // GH₵150.50
    expect(balance.add(4950).toString()).toBe('200.00')
    expect(balance.sub(50).toString()).toBe('150.00')
    expect(balance.eq(15050)).toBe(true)
    expect(balance.gt(15049)).toBe(true)
  })

  it('sum over raw cent counts is exact', () => {
    expect(Money.sum([1, 2, 3, 15050]).toString()).toBe('150.56')
  })
})
