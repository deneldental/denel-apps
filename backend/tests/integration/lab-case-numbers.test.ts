/**
 * Lab-case numbers (LC-000123) are unique and survive a lost race. See
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.14).
 *
 * `POST /api/labs/cases` chose the number as "the number on the most recently CREATED case, plus
 * one" and inserted it without any retry. Two things go wrong with that against a real database:
 *
 *   - when cases are not in number order (an import, a restore, a case created with a back-dated
 *     clock) the newest row is not the highest, and the number offered is already taken;
 *   - two requests at the same moment read the same row, offer the same number, and the unique
 *     index refuses the second: the receptionist got the database's own message (the SQL and its
 *     parameters) instead of a lab case.
 *
 * ── Safety ── commits `lab_vendors` and `lab_cases` rows tagged `IT labnum …` and removes them;
 * local Postgres only.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/lab-case-numbers.test.ts
 */
import { eq, ilike, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DB } from '../../src/db'
import { labCases, labVendors } from '../../src/db/schema'
import { insertLabCase, LAB_CASE_ATTEMPTS, nextLabCaseNumber } from '../../src/lib/lab-case-service'
import { isLocalDb, localDb } from './_session'

const skip = !isLocalDb
const db = localDb() as DB
const TAG = `IT labnum ${Date.now()}`
const numberOf = (caseNumber: string) => Number(caseNumber.replace(/^LC-/, ''))

let vendorId = ''

/** The columns a lab case needs; everything else has a default. */
const caseValues = (label: string) => ({
  vendorId,
  serviceName: `${TAG} ${label}`,
  domain: 'internal' as const,
})

async function sweep() {
  const vendors = await db
    .select({ id: labVendors.id })
    .from(labVendors)
    .where(ilike(labVendors.name, `${TAG}%`))
  const ids = vendors.map((v) => v.id)
  if (ids.length) await db.delete(labCases).where(inArray(labCases.vendorId, ids))
  await db.delete(labVendors).where(ilike(labVendors.name, `${TAG}%`))
}

describe.skipIf(skip)('lab-case numbers (review)', () => {
  beforeAll(async () => {
    const [vendor] = await db
      .insert(labVendors)
      .values({ name: `${TAG} vendor`, type: 'external' })
      .returning({ id: labVendors.id })
    vendorId = vendor.id
  })

  afterAll(async () => {
    await sweep()
  })

  it('numbers a case LC- followed by six digits, one after the highest', async () => {
    const before = numberOf(await nextLabCaseNumber(db))
    const created = await insertLabCase(db, caseValues('first'))
    expect(created.caseNumber).toMatch(/^LC-\d{6,}$/)
    expect(numberOf(created.caseNumber)).toBeGreaterThanOrEqual(before)
    const next = await nextLabCaseNumber(db)
    expect(numberOf(next)).toBe(numberOf(created.caseNumber) + 1)
  })

  it('offers a free number even when the newest case is not the highest', async () => {
    const base = numberOf(await nextLabCaseNumber(db))
    // The higher number is created FIRST, the lower one after it: the newest row is not the highest.
    await db.insert(labCases).values({
      ...caseValues('older, higher'),
      caseNumber: `LC-${String(base + 1).padStart(6, '0')}`,
    })
    await db
      .insert(labCases)
      .values({ ...caseValues('newer, lower'), caseNumber: `LC-${String(base).padStart(6, '0')}` })

    const created = await insertLabCase(db, caseValues('after the muddle'))
    expect(numberOf(created.caseNumber)).toBe(base + 2)
  })

  it('is not thrown off by case numbers it did not issue', async () => {
    const before = await nextLabCaseNumber(db)
    await db.insert(labCases).values({ ...caseValues('legacy'), caseNumber: 'LEGACY-7' })
    await db.insert(labCases).values({ ...caseValues('huge'), caseNumber: 'LC-1793059936843' })
    expect(await nextLabCaseNumber(db)).toBe(before)
  })

  it('tries again with a fresh number when the one it chose was taken first', async () => {
    const taken = await insertLabCase(db, caseValues('taken'))
    let offers = 0
    const stubborn = async (handle: DB) => {
      // The first offer is a number that already exists (as if another request had just taken it);
      // the second is the real next one.
      offers++
      return offers === 1 ? taken.caseNumber : nextLabCaseNumber(handle)
    }
    const created = await insertLabCase(db, caseValues('second try'), stubborn)
    expect(offers).toBe(2)
    expect(created.caseNumber).not.toBe(taken.caseNumber)
    expect(numberOf(created.caseNumber)).toBe(numberOf(taken.caseNumber) + 1)
  })

  it('gives up with the unique violation after a bounded number of attempts', async () => {
    const taken = await insertLabCase(db, caseValues('always taken'))
    let offers = 0
    const alwaysTaken = async () => {
      offers++
      return taken.caseNumber
    }
    await expect(insertLabCase(db, caseValues('doomed'), alwaysTaken)).rejects.toBeTruthy()
    expect(offers).toBe(LAB_CASE_ATTEMPTS)
    // Nothing half-written: the doomed case does not exist.
    const rows = await db
      .select()
      .from(labCases)
      .where(eq(labCases.serviceName, `${TAG} doomed`))
    expect(rows).toHaveLength(0)
  })

  it("leaves the caller's own transaction usable after a lost race", async () => {
    const taken = await insertLabCase(db, caseValues('held'))
    let offers = 0
    const stubborn = async (handle: DB) => {
      offers++
      return offers === 1 ? taken.caseNumber : nextLabCaseNumber(handle)
    }
    const { created, after } = await db.transaction(async (tx) => {
      const created = await insertLabCase(tx as unknown as DB, caseValues('inside'), stubborn)
      // The refused insert did not abort the caller's transaction: it can still write.
      const [after] = await tx
        .insert(labCases)
        .values({ ...caseValues('after'), caseNumber: 'LEGACY-9' })
        .returning()
      return { created, after }
    })
    expect(offers).toBe(2)
    expect(created.caseNumber).not.toBe(taken.caseNumber)
    expect(after.caseNumber).toBe('LEGACY-9')
  })

  it('gives every one of several cases created at the same moment its own number', async () => {
    const labels = ['race1', 'race2', 'race3', 'race4']
    const created = await Promise.all(labels.map((label) => insertLabCase(db, caseValues(label))))
    const numbers = created.map((c) => c.caseNumber)
    expect(new Set(numbers).size).toBe(labels.length)
  })

  it('does not retry a failure that is not a number collision', async () => {
    let offers = 0
    const counted = async (handle: DB) => {
      offers++
      return nextLabCaseNumber(handle)
    }
    // A vendor that does not exist: a foreign-key violation, which retrying cannot fix.
    await expect(
      insertLabCase(
        db,
        { ...caseValues('no vendor'), vendorId: '00000000-0000-4000-8000-000000000000' },
        counted
      )
    ).rejects.toBeTruthy()
    expect(offers).toBe(1)
  })
})
