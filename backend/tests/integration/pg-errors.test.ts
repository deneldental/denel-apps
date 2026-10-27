/**
 * isUniqueViolation — recognising a Postgres unique violation raised through
 * drizzle.
 *
 * The reason it exists: drizzle wraps the driver's error, so the SQLSTATE
 * `code` and the `constraint` live on `error.cause`, not on the thrown value.
 * A handler written as `err.code === '23505'` never matches. The first block
 * pins the shape against a REAL violation — if drizzle ever stops wrapping, or
 * wraps differently, that test fails and tells us why — and the second covers
 * the helper's logic without a database.
 */
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { DB } from '../../src/db'
import { user } from '../../src/db/schema'
import { isUniqueViolation } from '../../src/lib/pg-errors'
import { noDb, withRollback } from './_setup'

async function duplicateEmailError(tx: DB): Promise<unknown> {
  const email = `pgerr-${randomUUID().slice(0, 8)}@it.local`
  const row = () => ({
    id: randomUUID(),
    name: 'IT dup',
    email,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await tx.insert(user).values(row())
  try {
    // A savepoint, so the aborted statement doesn't poison the sandbox transaction.
    await tx.transaction(async (sp) => {
      await sp.insert(user).values(row())
    })
  } catch (err) {
    return err
  }
  throw new Error('expected a unique violation')
}

describe.skipIf(noDb)('a real unique violation through drizzle', () => {
  it('has no top-level code — the Postgres error is on .cause', async () => {
    await withRollback(async (tx) => {
      const err = (await duplicateEmailError(tx)) as {
        code?: unknown
        cause?: { code?: string; constraint?: string }
      }
      // The trap: the obvious check finds nothing.
      expect(err.code).toBeUndefined()
      expect(err.cause?.code).toBe('23505')
      expect(err.cause?.constraint).toBe('user_email_unique')
    })
  })

  it('is recognised, and matches only its own constraint', async () => {
    await withRollback(async (tx) => {
      const err = await duplicateEmailError(tx)
      expect(isUniqueViolation(err)).toBe(true)
      expect(isUniqueViolation(err, 'user_email_unique')).toBe(true)
      expect(isUniqueViolation(err, 'some_other_unique')).toBe(false)
    })
  })
})

describe('isUniqueViolation', () => {
  const pg = (over: Record<string, unknown> = {}) => ({
    code: '23505',
    constraint: 'x_unique',
    ...over,
  })

  it('recognises a bare driver error', () => {
    expect(isUniqueViolation(pg())).toBe(true)
  })

  it('recognises one wrapped at any depth of the cause chain', () => {
    expect(isUniqueViolation(Object.assign(new Error('wrapped'), { cause: pg() }))).toBe(true)
    expect(
      isUniqueViolation(
        Object.assign(new Error('a'), { cause: Object.assign(new Error('b'), { cause: pg() }) })
      )
    ).toBe(true)
  })

  it('filters by constraint when asked', () => {
    expect(isUniqueViolation(pg(), 'x_unique')).toBe(true)
    expect(isUniqueViolation(pg(), 'y_unique')).toBe(false)
    expect(isUniqueViolation(Object.assign(new Error('w'), { cause: pg() }), 'y_unique')).toBe(
      false
    )
  })

  it('does not mistake other Postgres errors for a unique violation', () => {
    expect(isUniqueViolation(pg({ code: '23503' }))).toBe(false) // foreign_key_violation
    expect(isUniqueViolation(pg({ code: '25P02' }))).toBe(false) // in_failed_sql_transaction
  })

  it('is false for values that are not errors', () => {
    for (const v of [null, undefined, 0, '23505', true, {}, []]) {
      expect(isUniqueViolation(v)).toBe(false)
    }
  })

  it('terminates on a cyclic cause chain', () => {
    const a: { cause?: unknown } = {}
    a.cause = a
    expect(isUniqueViolation(a)).toBe(false)
  })
})
