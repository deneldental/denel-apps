/**
 * `Cents` — the unit of every money value that crosses the API.
 *
 * WHAT THE UNIT IS
 * ----------------
 * An integer count of MINOR UNITS of the Ghana cedi. The minor unit is the
 * PESEWA (100 pesewas = GH₵1); this codebase has always called it a "cent", and
 * that name is kept deliberately — see §1a of
 * project-docs/money-unit-audit-and-remediation.md. Same 1/100 unit, one name.
 *
 * It lives beside `currency.ts` and `money.ts`, not in `@denel/types`, so the
 * formatters and the `Money` class can name the unit in their own signatures
 * without a new package edge. The Phase 3 exit criterion is
 * `formatCurrency(value: Cents)`.
 *
 * WHY IT IS BRANDED
 * -----------------
 * Since migration 0209 every money column, API field and `Money` value is in
 * cents. Before this type, a cent count and a cedis amount were both `number`,
 * so nothing could tell them apart — and a GHS 18,000.00 invoice reached a
 * patient as "GHS 1800000.00" because a component formatted the raw integer.
 * The brand makes the unit part of the type, so the mistake becomes a compiler
 * error instead of a slip handed to a patient.
 *
 * HOW IT BEHAVES
 * --------------
 * `Cents` is assignable TO `number` (arithmetic and existing helpers keep
 * working), but a plain `number` is NOT assignable to `Cents`. Values enter
 * through one of the constructors below, which is where a human states the unit
 * once, on purpose.
 *
 *   const total = cents(180000)          // I have a cent count
 *   const total = cedisToCents(1800)     // I have cedis; convert, rounding once
 *   formatCurrency(invoice.total)        // fine — Cents is a number
 *   invoice.total = 1800                 // ERROR — is that cedis or cents?
 *
 * ROLLOUT
 * -------
 * Applied first to the invoice/payment/plan response types. The end state is
 * `formatCurrency(value: Cents)`: once the last hand-rolled formatter is gone
 * (T8), that signature change makes the money-formatting guard test structural
 * and the guard can be deleted.
 */

declare const CENTS_BRAND: unique symbol

/** An integer count of pesewas. GH₵18,000.00 is `1800000`. */
export type Cents = number & { readonly [CENTS_BRAND]: true }

/**
 * Tag a number that is ALREADY a cent count — a value off the API, out of the
 * database, or a literal you are writing in cents.
 *
 * Throws on a non-integer: a fractional cent is never a real amount, and the
 * integer columns reject it anyway (this is the `fixed-assets.ts` Class C bug).
 */
export function cents(value: number): Cents {
  if (!Number.isInteger(value)) {
    throw new Error(
      `cents(): expected a whole number of pesewas, got ${value}. ` +
        'Use cedisToCents() for a cedis amount.'
    )
  }
  return value as Cents
}

/**
 * Convert a cedis amount to cents, rounding to the nearest pesewa.
 *
 * This is the ONE place a user-entered "18000.50" becomes 1800050 — the
 * boundary every money input has to cross. `Math.round` is what the correct
 * write paths already do (`Math.round(x * 100)`); the ones that skipped it are
 * the Class B defects that store 100x too little.
 *
 * Float caveat: at an exact half-pesewa the result is decided by binary
 * representation error rather than a rule — `1.005 * 100` is `100.4999…` (rounds
 * down) while `2.005 * 100` is `200.5000…3` (rounds up). A number that has
 * already lost precision cannot be repaired here. If you still hold the user's
 * STRING, prefer `parseCurrency`: it parses the decimal exactly via
 * `Money.fromString` and rounds HALF-EVEN. `cents.test.ts` pins both.
 */
export function cedisToCents(cedis: number): Cents {
  if (!Number.isFinite(cedis)) {
    throw new Error(`cedisToCents(): expected a finite amount, got ${cedis}`)
  }
  return Math.round(cedis * 100) as Cents
}

/** Zero, typed. */
export const ZERO_CENTS = 0 as Cents

/**
 * Parse an untrusted API value (number or numeric string) into `Cents`.
 * Nullish and unparseable inputs become zero rather than NaN, matching how the
 * formatters already treat them.
 */
export function toCents(value: number | string | null | undefined): Cents {
  if (value == null || value === '') return ZERO_CENTS
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return ZERO_CENTS
  return Math.round(n) as Cents
}
