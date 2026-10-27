/**
 * F25 — `lib/pg-errors.ts`: recognising a unique violation the way Drizzle really delivers it. See
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.13).
 *
 * Drizzle wraps the driver's error. The Postgres error, with its SQLSTATE `code`, the `constraint`
 * it broke and its `detail` sentence, sits on `err.cause`; the wrapper has none of them. A check on
 * `err.code` therefore never matches. These tests build errors the same shape and pin the helpers.
 */
import { describe, expect, it } from 'vitest'
import { isUniqueViolation, uniqueViolationOf } from '../../src/lib/pg-errors'

/** What node-postgres throws for a duplicate. */
const pgDuplicate = (extra: Record<string, unknown> = {}) =>
  Object.assign(new Error('duplicate key value violates unique constraint "t_name_key"'), {
    code: '23505',
    constraint: 't_name_key',
    detail: 'Key (name)=(Crown) already exists.',
    ...extra,
  })

/** What Drizzle hands the route: a wrapper with the driver's error as its cause. */
const wrapped = (cause: unknown) =>
  Object.assign(new Error('Failed query: insert into …'), { cause })

describe('isUniqueViolation', () => {
  it('sees a duplicate that Drizzle wrapped (the case err.code === "23505" never matched)', () => {
    const err = wrapped(pgDuplicate())
    expect((err as { code?: string }).code).toBeUndefined() // the wrapper has no code of its own
    expect(isUniqueViolation(err)).toBe(true)
  })

  it('sees an unwrapped driver error too', () => {
    expect(isUniqueViolation(pgDuplicate())).toBe(true)
  })

  it('sees one buried a few causes down', () => {
    expect(isUniqueViolation(wrapped(wrapped(wrapped(pgDuplicate()))))).toBe(true)
  })

  it('stops looking after a handful of links, and survives a cause that points back', () => {
    let deep: unknown = pgDuplicate()
    for (let i = 0; i < 6; i++) deep = wrapped(deep)
    expect(isUniqueViolation(deep)).toBe(false)

    const a: { cause?: unknown } = {}
    const b: { cause?: unknown } = { cause: a }
    a.cause = b
    expect(isUniqueViolation(a)).toBe(false) // terminates instead of hanging the request
  })

  it('can be narrowed to one constraint, so "name taken" does not swallow another index', () => {
    const err = wrapped(pgDuplicate())
    expect(isUniqueViolation(err, 't_name_key')).toBe(true)
    expect(isUniqueViolation(err, 'some_other_key')).toBe(false)
  })

  it.each([
    ['a foreign-key violation', wrapped(pgDuplicate({ code: '23503' }))],
    ['a plain error', new Error('boom')],
    ['a string', 'duplicate key value violates unique constraint'],
    ['null', null],
    ['undefined', undefined],
    ['a number', 23505],
    ['the SQLSTATE as a number', wrapped(pgDuplicate({ code: 23505 }))],
  ])('is false for %s', (_what, err) => {
    expect(isUniqueViolation(err)).toBe(false)
  })

  it('does not go by the message: the words "unique" or "duplicate" prove nothing', () => {
    expect(isUniqueViolation(new Error('duplicate key value violates unique constraint'))).toBe(
      false
    )
  })
})

describe('uniqueViolationOf', () => {
  it('returns the constraint and Postgres’s own sentence, from the cause', () => {
    expect(uniqueViolationOf(wrapped(pgDuplicate()))).toEqual({
      constraint: 't_name_key',
      detail: 'Key (name)=(Crown) already exists.',
    })
  })

  it('leaves out what is not text', () => {
    expect(uniqueViolationOf(pgDuplicate({ constraint: 5, detail: { x: 1 } }))).toEqual({
      constraint: undefined,
      detail: undefined,
    })
  })

  it('is null when there is no unique violation, and honours a constraint filter', () => {
    expect(uniqueViolationOf(new Error('boom'))).toBeNull()
    expect(uniqueViolationOf(wrapped(pgDuplicate()), 'other_key')).toBeNull()
    expect(uniqueViolationOf(wrapped(pgDuplicate()), 't_name_key')?.constraint).toBe('t_name_key')
  })
})
