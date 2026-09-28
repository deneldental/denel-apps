/**
 * Integration-test harness.
 *
 * Integration tests exercise the real finance services against a real
 * Postgres (the Doppler `dev` DB). They are the safety net the remediation
 * plan (R1–R3) depends on — without them, the "service unit tests" only prove
 * `Money` works, not that the services are correct (audit finding H2).
 *
 * Isolation: every test runs inside `withRollback`, a transaction that is
 * ALWAYS rolled back, so tests never mutate the shared dev DB. Service code
 * under test receives the `tx` handle; any `db.transaction()` the service
 * opens nests as a SAVEPOINT — exactly how the production call sites already
 * pass `tx` into `postJournalEntry` etc.
 *
 * Tests gate on `DATABASE_URL`: `pnpm test` (no Doppler) skips them;
 * `doppler run -- pnpm test` runs them.
 */

import { type DB, getDb } from '../../src/db'

export const DATABASE_URL = process.env.DATABASE_URL

/** Use as `describe.skipIf(noDb)` — integration tests need a real DB. */
export const noDb = !DATABASE_URL

export function getTestDb(): DB {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is required for integration tests')
  }
  return getDb(DATABASE_URL)
}

// Sentinel thrown to force a transaction rollback without surfacing a real error.
const ROLLBACK = Symbol('integration-test-rollback')

/**
 * Run `fn` inside a transaction that is always rolled back. The dev DB is
 * never mutated. Returns whatever `fn` returned (captured before rollback).
 *
 *   await withRollback(async (tx) => {
 *     const { invoice } = await issueInvoice(tx, draftId, userId)
 *     expect(invoice.status).toBe('issued')
 *   })
 */
export async function withRollback<T>(fn: (tx: DB) => Promise<T>): Promise<T> {
  const db = getTestDb()
  let captured: T | undefined
  let captureErr: unknown
  try {
    await db.transaction(async (tx) => {
      try {
        captured = await fn(tx as unknown as DB)
      } catch (err) {
        captureErr = err
      }
      // Always abort — the transaction is a disposable sandbox.
      throw ROLLBACK
    })
  } catch (err) {
    if (err !== ROLLBACK) throw err
  }
  if (captureErr) throw captureErr
  return captured as T
}

/**
 * Convenience: assert that `fn` rejects, while still rolling the sandbox tx
 * back. Use for "the DB / service must reject this" regression tests.
 */
export async function expectRejection(
  fn: (tx: DB) => Promise<unknown>,
  matcher?: RegExp | string
): Promise<Error> {
  let thrown: Error | undefined
  await withRollback(async (tx) => {
    try {
      await fn(tx)
    } catch (err) {
      thrown = err as Error
    }
  })
  if (!thrown) throw new Error('expected the operation to reject, but it resolved')
  if (matcher) {
    const msg = thrown.message ?? String(thrown)
    const ok = matcher instanceof RegExp ? matcher.test(msg) : msg.includes(matcher)
    if (!ok) {
      throw new Error(`rejection message ${JSON.stringify(msg)} did not match ${matcher}`)
    }
  }
  return thrown
}
