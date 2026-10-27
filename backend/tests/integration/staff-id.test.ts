/**
 * `nextStaffId` — the one place a Staff ID (FDM-S0001, FDM-S0002, …) is chosen. See
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.14).
 *
 * Three routes had their own copy of "the highest number plus one", and the copies had two faults
 * that only show against a real database:
 *
 *   - they cast the digits of every staff ID to an integer, so one ID with no digits or with more
 *     than nine (hand-typed, imported, or a test fixture named after the clock) made the query fail
 *     and refused every creation for everyone;
 *   - they read the highest number without any lock, so two requests at once chose the same ID and
 *     the second failed on the unique username.
 *
 * ── Safety ── commits staff rows named `IT nsi …` inside short transactions and removes them; local
 * Postgres only.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/staff-id.test.ts
 */
import { ilike } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import type { DB } from '../../src/db'
import { staff } from '../../src/db/schema'
import { nextStaffId } from '../../src/lib/staff-id'
import { isLocalDb, localDb } from './_session'

const skip = !isLocalDb
const db = localDb() as DB
const TAG = `IT nsi ${Date.now()}`
const numberOf = (id: string) => Number(id.replace(/\D/g, ''))
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function insertStaff(tx: Pick<DB, 'insert'>, staffId: string, label: string) {
  await tx.insert(staff).values({
    staffId,
    fullName: `${TAG} ${label}`,
    employmentType: 'permanent',
  })
}

describe.skipIf(skip)('nextStaffId (review)', () => {
  afterEach(async () => {
    await db.delete(staff).where(ilike(staff.fullName, `${TAG}%`))
  })

  it('hands out FDM-S followed by at least four digits', async () => {
    const id = await db.transaction((tx) => nextStaffId(tx))
    expect(id).toMatch(/^FDM-S\d{4,}$/)
  })

  it('continues from the highest ID it handed out', async () => {
    const first = await db.transaction((tx) => nextStaffId(tx))
    await insertStaff(db, first, 'first')
    const second = await db.transaction((tx) => nextStaffId(tx))
    expect(numberOf(second)).toBe(numberOf(first) + 1)
  })

  it('is not thrown off by staff IDs it did not hand out', async () => {
    const before = await db.transaction((tx) => nextStaffId(tx))
    // More than nine digits, no digits at all, another prefix: each one broke the old query.
    await insertStaff(db, 'IT-NSI-1793059936843', 'long digits')
    await insertStaff(db, 'IT-NSI-LETTERS', 'no digits')
    await insertStaff(db, 'FDM-X9999999', 'backfill prefix')
    await insertStaff(db, 'FDM-S1793059936843', 'our prefix, too many digits')
    const after = await db.transaction((tx) => nextStaffId(tx))
    expect(after).toBe(before)
  })

  it('makes a second request wait for the first to commit, then continue after it', async () => {
    let secondChose: string | null = null
    let second: Promise<string> | null = null
    let waitedWhileFirstWasOpen = false

    const first = await db.transaction(async (tx1) => {
      const id = await nextStaffId(tx1)
      second = db.transaction(async (tx2) => {
        const chosen = await nextStaffId(tx2)
        secondChose = chosen
        return chosen
      })
      // Give the second request every chance to run ahead; it must be held at the lock.
      await wait(500)
      waitedWhileFirstWasOpen = secondChose === null
      await insertStaff(tx1, id, 'first')
      return id
    })
    const other = await (second as Promise<string> | null)

    expect(waitedWhileFirstWasOpen).toBe(true)
    expect(other).not.toBeNull()
    expect(numberOf(other as string)).toBe(numberOf(first) + 1)
  })
})
