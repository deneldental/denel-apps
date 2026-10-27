/**
 * Recognising Postgres errors raised through drizzle.
 *
 * Drizzle wraps what the driver throws: the Postgres error — with its SQLSTATE
 * `code` and the violated `constraint` — sits on `error.cause`, and the wrapper
 * itself has neither. `err.code === '23505'` therefore never matches, and a
 * catch built on it quietly lets every unique violation through as a 500 (or,
 * in a retry loop, rethrows on the first collision and never retries).
 *
 * Use these instead of reading `.code` off the thrown value.
 */

/** Postgres SQLSTATE for unique_violation. */
const UNIQUE_VIOLATION = '23505'

interface PgErrorLike {
  code?: unknown
  constraint?: unknown
  detail?: unknown
  cause?: unknown
}

/** What a unique violation says about itself: the index it broke and Postgres's own sentence. */
export interface UniqueViolation {
  constraint?: string
  /** e.g. `Key (email)=(a@b.c) already exists.` */
  detail?: string
}

/** Bounded: a cause chain is a handful deep, and a cycle must not hang a request. */
const MAX_CAUSE_DEPTH = 5

/**
 * The unique violation inside `err` — the error itself or anything in its `cause` chain — or
 * `null`. Use this when the handler wants to say WHICH value collided; use `isUniqueViolation`
 * when "it already exists" is the whole answer.
 */
export function uniqueViolationOf(err: unknown, constraint?: string): UniqueViolation | null {
  let current: unknown = err
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current && typeof current === 'object'; depth++) {
    const e = current as PgErrorLike
    if (e.code === UNIQUE_VIOLATION && (constraint === undefined || e.constraint === constraint)) {
      return {
        constraint: typeof e.constraint === 'string' ? e.constraint : undefined,
        detail: typeof e.detail === 'string' ? e.detail : undefined,
      }
    }
    current = e.cause
  }
  return null
}

/**
 * True when `err` — or anything in its `cause` chain — is a Postgres unique
 * violation. Pass `constraint` to match one specific unique index only, so a
 * handler for "email taken" can't swallow a collision on something else.
 */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  return uniqueViolationOf(err, constraint) !== null
}
