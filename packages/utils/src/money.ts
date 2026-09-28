// Money — exact-arithmetic GHS amount type backed by Dinero.js + BigInt cents.
//
// All finance code MUST use this for arithmetic on monetary amounts.
//
// EXACTNESS CONTRACT (R1):
//   add / sub / sum / neg / abs ........ exact (pure BigInt)
//   mul / div / percent / proportion ... exact — the scalar is converted to an
//                                        exact rational and the division is
//                                        done in BigInt with the remainder
//                                        rounded once via `RoundingMode`.
//   fromNumber ......................... rounds the float ONCE at the
//                                        construction boundary (a JS number
//                                        cannot carry more than ~15 digits;
//                                        this is the unavoidable lossy edge).
//
// There is intentionally NO operation that does float arithmetic *per call* —
// that was the pre-R1 bug (code-report-v1.md C1/C2). Dinero.js handles the
// exact monetary object model; the only float touch-points are the explicit
// `fromNumber` / `toNumber` boundaries.
//
// Storage: 1 GHS = 100 cents. DB column type: `integer` (cents).
// `Money.fromDb` accepts number (cents) or string (cents).

export type MoneyLike = Money | number | string | bigint

export type RoundingMode = 'half-even' | 'half-up' | 'half-down' | 'floor' | 'ceil'

import {
  dinero,
  add as dineroAdd,
  allocate as dineroAllocate,
  compare as dineroCompare,
  equal as dineroEqual,
  greaterThan as dineroGreaterThan,
  greaterThanOrEqual as dineroGreaterThanOrEqual,
  lessThan as dineroLessThan,
  lessThanOrEqual as dineroLessThanOrEqual,
  subtract as dineroSubtract,
  toDecimal,
  toSnapshot,
} from 'dinero.js/bigint'
import { GHS } from 'dinero.js/bigint/currencies'

type GhsDinero = ReturnType<typeof dinero>

function toDinero(cents: bigint): GhsDinero {
  return dinero({ amount: cents, currency: GHS })
}

function fromDinero(value: GhsDinero): Money {
  return Money.fromCents(toSnapshot(value).amount)
}

const SCALE = 2n
const SCALE_FACTOR = 100n

export class Money {
  private readonly cents: bigint

  private constructor(cents: bigint) {
    // Normalise -0n → 0n so `toString()` never emits "-0.00".
    this.cents = cents === 0n ? 0n : cents
  }

  // ─── Constructors ───────────────────────────────────────────────────────────

  static zero(): Money {
    return new Money(0n)
  }

  /** Construct from an integer cent count. Throws on a fractional number. */
  static fromCents(cents: bigint | number): Money {
    if (typeof cents === 'number') {
      if (!Number.isInteger(cents)) {
        throw new Error(`Money.fromCents: expected an integer cent count, got ${cents}`)
      }
      return new Money(BigInt(cents))
    }
    return new Money(cents)
  }

  static fromNumber(value: number, rounding: RoundingMode = 'half-even'): Money {
    if (!Number.isFinite(value)) {
      throw new Error(`Money.fromNumber: non-finite value ${value}`)
    }
    return new Money(roundFloatToBigInt(value * 100, rounding))
  }

  /**
   * Parse a decimal string. A 3rd-or-deeper fractional digit is ROUNDED into
   * the cent (banker's rounding by default) — never silently truncated.
   */
  static fromString(value: string, rounding: RoundingMode = 'half-even'): Money {
    const trimmed = value.trim()
    if (trimmed === '') throw new Error('Money.fromString: empty string')
    const negative = trimmed.startsWith('-')
    const body = negative ? trimmed.slice(1) : trimmed
    if (!/^\d+(\.\d*)?$/.test(body)) {
      throw new Error(`Money.fromString: invalid format "${value}"`)
    }
    const [intPart, fracPartRaw = ''] = body.split('.')
    const fracPadded = `${fracPartRaw}00`
    const centsStr = fracPadded.slice(0, 2)
    // Digits beyond the cent — the sub-cent remainder we must round on.
    const subCent = fracPadded.slice(2).replace(/0+$/, '')

    let cents = BigInt(intPart) * SCALE_FACTOR + BigInt(centsStr)

    if (subCent !== '') {
      const remNum = BigInt(subCent)
      const remDen = 10n ** BigInt(subCent.length)
      const twoRem = remNum * 2n
      let bump: boolean
      switch (rounding) {
        case 'floor':
          bump = false
          break
        case 'ceil':
          bump = remNum > 0n
          break
        case 'half-up':
          bump = twoRem >= remDen
          break
        case 'half-down':
          bump = twoRem > remDen
          break
        default: // half-even
          if (twoRem > remDen) bump = true
          else if (twoRem < remDen) bump = false
          else bump = cents % 2n === 1n // round the *cent* to even
          break
      }
      if (bump) cents += 1n
    }

    return new Money(negative ? -cents : cents)
  }

  /**
   * Construct from a value coming back from the database.
   * Since the DB migration to `integer`, columns now arrive as numbers (cents).
   */
  static fromDb(value: string | number | null | undefined): Money {
    if (value === null || value === undefined) return Money.zero()

    // In postgres, integer columns are usually returned as numbers,
    // but bigint would be returned as strings. We support both.
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (!/^-?\d+$/.test(trimmed)) {
        throw new Error(
          `Money.fromDb: expected an integer cent count, got "${value}". ` +
            'Use Money.fromString() for a decimal cedis string.'
        )
      }
      return new Money(BigInt(trimmed))
    }
    return Money.fromCents(value)
  }

  /**
   * The general coercion used by every arithmetic method (`add`, `sub`, `eq`,
   * …) and by service code reading money off the database or a request body.
   *
   * A plain `number` or `string` here is an integer CENT COUNT — the unit the
   * DB columns, the HTTP API, and `Money` itself all speak. It is NOT cedis:
   * for that, call `Money.fromNumber(150.5)` explicitly.
   *
   * This used to treat a number as cedis, which silently made every
   * `Money.from(invoice.balance)` 100x too large once migration 0209 converted
   * the money columns to integer cents. A non-integer now throws rather than
   * being quietly scaled — a loud failure beats a wrong ledger.
   */
  static from(value: MoneyLike): Money {
    if (value instanceof Money) return value
    if (typeof value === 'bigint') return Money.fromCents(value)
    if (typeof value === 'number') {
      if (!Number.isInteger(value)) {
        throw new Error(
          `Money.from: expected an integer cent count, got ${value}. ` +
            'Pass cents, or use Money.fromNumber() for a cedis amount.'
        )
      }
      return Money.fromCents(value)
    }
    return Money.fromDb(value)
  }

  // ─── Arithmetic ─────────────────────────────────────────────────────────────

  add(other: MoneyLike): Money {
    return fromDinero(dineroAdd(toDinero(this.cents), toDinero(Money.from(other).cents)))
  }

  sub(other: MoneyLike): Money {
    return fromDinero(dineroSubtract(toDinero(this.cents), toDinero(Money.from(other).cents)))
  }

  /**
   * Multiply by a unitless scalar (quantity, or a rate like 0.15). The scalar
   * is converted to an exact rational `num/den` from its decimal expansion;
   * the multiply + divide happen in BigInt and the remainder is rounded once.
   */
  mul(scalar: number, rounding: RoundingMode = 'half-even'): Money {
    const { num, den } = scalarToRational(scalar)
    return new Money(divRound(this.cents * num, den, rounding))
  }

  /** Divide by a unitless scalar. Exact (BigInt), rounds to the nearest cent. */
  div(scalar: number, rounding: RoundingMode = 'half-even'): Money {
    if (scalar === 0) throw new Error('Money.div: division by zero')
    const { num, den } = scalarToRational(scalar)
    // this / (num/den) = this * den / num
    return new Money(divRound(this.cents * den, num, rounding))
  }

  /** Apply a percentage (15 = 15%). Exact — `this.cents * p / 100` in BigInt. */
  percent(percentage: number, rounding: RoundingMode = 'half-even'): Money {
    const { num, den } = scalarToRational(percentage)
    return new Money(divRound(this.cents * num, den * 100n, rounding))
  }

  /**
   * Take the `numerator / denominator` fraction of this amount, exactly.
   * Replaces the lossy `a.toNumber() / b.toNumber()` ratio pattern — used for
   * proportional commission transitions, tax reversals, etc.
   */
  proportion(
    numerator: MoneyLike,
    denominator: MoneyLike,
    rounding: RoundingMode = 'half-even'
  ): Money {
    const n = Money.from(numerator).cents
    const d = Money.from(denominator).cents
    if (d === 0n) throw new Error('Money.proportion: division by zero')
    return new Money(divRound(this.cents * n, d, rounding))
  }

  neg(): Money {
    return new Money(-this.cents)
  }

  abs(): Money {
    return new Money(this.cents < 0n ? -this.cents : this.cents)
  }

  // ─── Comparison ─────────────────────────────────────────────────────────────

  cmp(other: MoneyLike): -1 | 0 | 1 {
    return dineroCompare(toDinero(this.cents), toDinero(Money.from(other).cents))
  }

  eq(other: MoneyLike): boolean {
    return dineroEqual(toDinero(this.cents), toDinero(Money.from(other).cents))
  }

  gt(other: MoneyLike): boolean {
    return dineroGreaterThan(toDinero(this.cents), toDinero(Money.from(other).cents))
  }

  gte(other: MoneyLike): boolean {
    return dineroGreaterThanOrEqual(toDinero(this.cents), toDinero(Money.from(other).cents))
  }

  lt(other: MoneyLike): boolean {
    return dineroLessThan(toDinero(this.cents), toDinero(Money.from(other).cents))
  }

  lte(other: MoneyLike): boolean {
    return dineroLessThanOrEqual(toDinero(this.cents), toDinero(Money.from(other).cents))
  }

  isZero(): boolean {
    return this.cents === 0n
  }

  isPositive(): boolean {
    return this.cents > 0n
  }

  isNegative(): boolean {
    return this.cents < 0n
  }

  // ─── Conversion ─────────────────────────────────────────────────────────────

  /** Returns integer cents — useful for storage in INT columns or transport. */
  toCents(): bigint {
    return toSnapshot(toDinero(this.cents)).amount
  }

  /**
   * Returns the value as a plain JS number. EXACT for magnitudes below
   * Number.MAX_SAFE_INTEGER cents (~90 trillion GHS) — i.e. every clinic-scale
   * balance. Above that it is lossy; prefer `toString` / `toDbValue` for
   * storage and serialization.
   */
  toNumber(): number {
    return Number.parseFloat(this.toString())
  }

  /** Canonical decimal string with 2 fraction digits, e.g. "1234.56". */
  toString(): string {
    return toDecimal(toDinero(this.cents))
  }

  /** Format suitable for a Drizzle `integer` (cents) column. */
  toDbValue(): number {
    return Number(this.cents)
  }

  toJSON(): string {
    return this.toString()
  }

  // ─── Bulk helpers ───────────────────────────────────────────────────────────

  static sum(values: Iterable<MoneyLike>): Money {
    let total = toDinero(0n)
    for (const value of values) {
      total = dineroAdd(total, toDinero(Money.from(value).cents))
    }
    return fromDinero(total)
  }

  /**
   * Distribute a total across `parts` integer slices so the slices sum exactly
   * to the total. The remainder cents are spread ONE PER SLICE across the
   * leading slices (standard practice) — so `0.07 / 11` yields seven `0.01`
   * slices and four `0.00`, not ten zeros and a `0.07`.
   */
  distribute(parts: number): Money[] {
    if (!Number.isInteger(parts) || parts <= 0) {
      throw new Error('Money.distribute: parts must be a positive integer')
    }
    return dineroAllocate(
      toDinero(this.cents),
      Array.from({ length: parts }, () => 1n)
    ).map(fromDinero)
  }
}

// ─── Internals ────────────────────────────────────────────────────────────────

/**
 * BigInt division with a rounded remainder. Works in absolute space and
 * re-applies the sign, so every mode is correct for negative results
 * (code-report-v1.md C2). `floor`/`ceil` are number-line directional;
 * `half-*` are magnitude-based.
 */
function divRound(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  if (denominator === 0n) throw new Error('Money: division by zero')
  const negResult = numerator < 0n !== denominator < 0n
  const absN = numerator < 0n ? -numerator : numerator
  const absD = denominator < 0n ? -denominator : denominator
  const q = absN / absD // floor of |result|
  const r = absN - q * absD // 0 <= r < absD
  if (r === 0n) return negResult ? -q : q

  let bumpMagnitude: boolean
  const twoR = r * 2n
  switch (mode) {
    case 'floor':
      // toward -infinity: a negative result rounds away from zero
      bumpMagnitude = negResult
      break
    case 'ceil':
      // toward +infinity: a positive result rounds away from zero
      bumpMagnitude = !negResult
      break
    case 'half-up':
      bumpMagnitude = twoR >= absD
      break
    case 'half-down':
      bumpMagnitude = twoR > absD
      break
    default: // half-even
      if (twoR > absD) bumpMagnitude = true
      else if (twoR < absD) bumpMagnitude = false
      else bumpMagnitude = q % 2n === 1n // round to even
      break
  }
  const mag = bumpMagnitude ? q + 1n : q
  return negResult ? -mag : mag
}

/**
 * Round a float to a BigInt. Used only at the `fromNumber` boundary. Rounds
 * the MAGNITUDE and re-applies the sign so every mode is correct for
 * negatives (code-report-v1.md C2).
 */
function roundFloatToBigInt(value: number, mode: RoundingMode): bigint {
  if (!Number.isFinite(value)) throw new Error('Money: non-finite intermediate')
  const negative = value < 0
  const abs = Math.abs(value)
  const floorAbs = Math.floor(abs)
  const frac = abs - floorAbs

  let mag: number
  if (frac === 0) {
    mag = floorAbs
  } else {
    switch (mode) {
      case 'floor':
        mag = negative ? floorAbs + 1 : floorAbs
        break
      case 'ceil':
        mag = negative ? floorAbs : floorAbs + 1
        break
      case 'half-up':
        mag = frac >= 0.5 ? floorAbs + 1 : floorAbs
        break
      case 'half-down':
        mag = frac > 0.5 ? floorAbs + 1 : floorAbs
        break
      default: // half-even
        if (frac > 0.5) mag = floorAbs + 1
        else if (frac < 0.5) mag = floorAbs
        else mag = floorAbs % 2 === 0 ? floorAbs : floorAbs + 1
        break
    }
  }

  const result = BigInt(mag)
  return negative ? -result : result
}

/**
 * Convert a unitless scalar to an exact rational `num / den` from its decimal
 * expansion. `0.15` → `{ num: 15n, den: 100n }`, `2` → `{ num: 2n, den: 1n }`.
 * The scalar arrives as a JS number, so its `toString()` IS the exact intent
 * we can act on. Exponent notation (only reachable for <1e-6 or ≥1e21 values,
 * never a real rate/quantity) is expanded first.
 */
function scalarToRational(scalar: number): { num: bigint; den: bigint } {
  if (!Number.isFinite(scalar)) {
    throw new Error(`Money: non-finite scalar ${scalar}`)
  }
  let s = scalar.toString()
  if (s.includes('e') || s.includes('E')) {
    s = expandExponent(s)
  }
  const negative = s.startsWith('-')
  if (negative) s = s.slice(1)
  const [intPart, fracPart = ''] = s.split('.')
  const digits = `${intPart}${fracPart}` || '0'
  let num = BigInt(digits)
  if (negative) num = -num
  const den = 10n ** BigInt(fracPart.length)
  return { num, den }
}

/** Expand `"1.5e-7"` / `"2e+21"` style strings to a plain decimal string. */
function expandExponent(s: string): string {
  const [mantissaRaw, expRaw] = s.toLowerCase().split('e')
  const exp = Number.parseInt(expRaw, 10)
  const negative = mantissaRaw.startsWith('-')
  const mantissa = negative ? mantissaRaw.slice(1) : mantissaRaw
  const [intP, fracP = ''] = mantissa.split('.')
  const digits = intP + fracP
  const pointPos = intP.length + exp // decimal point position from the left
  let result: string
  if (pointPos <= 0) {
    result = `0.${'0'.repeat(-pointPos)}${digits}`
  } else if (pointPos >= digits.length) {
    result = digits + '0'.repeat(pointPos - digits.length)
  } else {
    result = `${digits.slice(0, pointPos)}.${digits.slice(pointPos)}`
  }
  return (negative ? '-' : '') + result
}
