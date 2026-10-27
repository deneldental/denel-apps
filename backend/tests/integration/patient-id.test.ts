/**
 * Patient ID assignment (FD-YYMM-XXXX) and the retry around its unique constraint.
 *
 * Why this is tested against a forced collision: the first version of this retry
 * was never exercised, and it did not work — it looked for `err.code` (drizzle
 * puts the code on `err.cause`) and, even with that fixed, a failed INSERT
 * aborts the surrounding Postgres transaction, so every later attempt died with
 * "current transaction is aborted". Both flaws are invisible until two patients
 * actually draw the same suffix, which is a ~1-in-1.2M event per month — so the
 * collision has to be manufactured. `nextId` is the seam that makes that possible.
 *
 * Each case runs in `withRollback`, so the database is never mutated.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import type { DB } from '../../src/db'
import { patients } from '../../src/db/schema'
import { generatePatientId, insertPatientWithUniqueId } from '../../src/lib/patient-id'
import { noDb, withRollback } from './_setup'

const values = () => ({
  name: `IT PID ${randomUUID().slice(0, 8)}`,
  dob: new Date('1990-01-01'),
  gender: 'other',
})
const suffix = () =>
  randomUUID()
    .replace(/[^A-Z0-9]/gi, '')
    .slice(0, 4)
    .toUpperCase()

async function takenId(tx: DB): Promise<string> {
  const patientId = `FD-2610-${suffix()}`
  await tx.insert(patients).values({ ...values(), patientId })
  return patientId
}

describe('generatePatientId', () => {
  it('is FD-YYMM-XXXX', () => {
    expect(generatePatientId(new Date('2026-10-01T12:00:00Z'), () => 0)).toBe('FD-2610-AAAA')
    expect(generatePatientId()).toMatch(/^FD-\d{4}-[A-HJ-NP-Z2-9]{4}$/)
  })

  it('never emits the look-alike characters I, O, 0 or 1', () => {
    for (let i = 0; i < 200; i++) {
      expect(generatePatientId().slice(-4)).not.toMatch(/[IO01]/)
    }
  })
})

describe.skipIf(noDb)('insertPatientWithUniqueId', () => {
  it('assigns a generated id on the first try when there is no collision', async () => {
    await withRollback(async (tx) => {
      const nextId = vi.fn(() => `FD-2610-${suffix()}`)
      const row = await insertPatientWithUniqueId(tx, values(), nextId)
      expect(row.patientId).toMatch(/^FD-2610-/)
      expect(nextId).toHaveBeenCalledTimes(1)
    })
  })

  it('retries with a fresh id when the first one is already taken', async () => {
    await withRollback(async (tx) => {
      const taken = await takenId(tx)
      const fresh = `FD-2610-${suffix()}`
      const nextId = vi.fn().mockReturnValueOnce(taken).mockReturnValueOnce(fresh)

      const row = await insertPatientWithUniqueId(tx, values(), nextId)

      expect(row.patientId).toBe(fresh)
      expect(nextId).toHaveBeenCalledTimes(2)
      // The patient who already held the id is untouched, and ours is a new row.
      const holder = await tx.select().from(patients).where(eq(patients.patientId, taken))
      expect(holder).toHaveLength(1)
      expect(holder[0].id).not.toBe(row.id)
    })
  })

  it('survives several collisions in a row', async () => {
    await withRollback(async (tx) => {
      const a = await takenId(tx)
      const b = await takenId(tx)
      const c = await takenId(tx)
      const fresh = `FD-2610-${suffix()}`
      const ids = [a, b, c, fresh]
      const row = await insertPatientWithUniqueId(tx, values(), () => ids.shift() as string)
      expect(row.patientId).toBe(fresh)
    })
  })

  it('gives up after a bounded number of attempts instead of looping forever', async () => {
    await withRollback(async (tx) => {
      const taken = await takenId(tx)
      const nextId = vi.fn(() => taken)
      await expect(insertPatientWithUniqueId(tx, values(), nextId, 3)).rejects.toThrow()
      expect(nextId).toHaveBeenCalledTimes(3)
    })
  })

  // A retry is for "someone took this id", nothing else. Any other failure is a
  // real problem, and must surface at once rather than be retried five times.
  it('does not retry a failure that is not an id collision', async () => {
    await withRollback(async (tx) => {
      const nextId = vi.fn(() => `FD-2610-${suffix()}`)
      await expect(
        insertPatientWithUniqueId(tx, { ...values(), name: null as unknown as string }, nextId)
      ).rejects.toThrow()
      expect(nextId).toHaveBeenCalledTimes(1)
    })
  })

  it('leaves the surrounding transaction usable after a collision', async () => {
    await withRollback(async (tx) => {
      const taken = await takenId(tx)
      const ids = [taken, `FD-2610-${suffix()}`]
      await insertPatientWithUniqueId(tx, values(), () => ids.shift() as string)
      // A statement after the retry still works — the failed attempt was rolled
      // back to its savepoint, not left poisoning the transaction.
      const rows = await tx.select({ id: patients.id }).from(patients).limit(1)
      expect(rows.length).toBeGreaterThanOrEqual(1)
    })
  })
})
