/**
 * admin-v1 §13.4 — CRM audience-builder smoke tests for `resolveAudience`.
 *
 * Proves the composable filters (treatment-type / §2.7 tags / fixed segments)
 * AND together correctly and that do-not-contact patients (§13.3 / §18.1) are
 * ALWAYS excluded, regardless of the `excludeDoNotContact` flag.
 *
 * Run with `doppler run -- pnpm --filter backend test` (gated on DATABASE_URL).
 * Every test runs inside `withRollback` (always rolled back; the shared dev DB
 * is never mutated).
 */

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { DB } from '../../src/db'
import {
  appointments,
  doctors,
  medicalRecords,
  patients,
  patientTagLinks,
  patientTags,
  recarePlans,
  treatmentTypes,
} from '../../src/db/schema'
import { resolveAudience } from '../../src/routes/crm'
import { anyUserId, makeSpecialist } from './_fixtures'
import { noDb, withRollback } from './_setup'

// ── fixture builders ─────────────────────────────────────────────────────────

async function makeContactablePatient(
  tx: DB,
  opts: { doNotContact?: boolean; phone?: string } = {}
): Promise<string> {
  const [p] = await tx
    .insert(patients)
    .values({
      name: `IT Audience ${randomUUID().slice(0, 8)}`,
      dob: new Date('1990-06-10'), // June 10 — matches the test "today" for birthday seg
      gender: 'other',
      phone: opts.phone ?? '+233200000000',
      doNotContact: opts.doNotContact ?? false,
    })
    .returning()
  return p.id
}

/** A doctors row sourced from a specialist (satisfies the source-XOR check). */
async function makeDoctor(tx: DB): Promise<string> {
  const specialistId = await makeSpecialist(tx)
  const [d] = await tx
    .insert(doctors)
    .values({ specialistId, specialty: 'IT Dentistry' })
    .returning()
  return d.id
}

async function makeTreatmentType(tx: DB): Promise<string> {
  const [t] = await tx
    .insert(treatmentTypes)
    .values({ name: `IT Type ${randomUUID().slice(0, 8)}` })
    .returning()
  return t.id
}

async function makeTag(tx: DB): Promise<string> {
  const [t] = await tx
    .insert(patientTags)
    .values({ name: `IT Tag ${randomUUID().slice(0, 8)}` })
    .returning()
  return t.id
}

describe.skipIf(noDb)('CRM audience builder — resolveAudience (§13.4)', () => {
  it('treatment-type filter matches only patients with a record of that type', async () => {
    await withRollback(async (tx) => {
      const doctorId = await makeDoctor(tx)
      const typeA = await makeTreatmentType(tx)
      const typeB = await makeTreatmentType(tx)

      const pA = await makeContactablePatient(tx)
      const pB = await makeContactablePatient(tx)

      await tx.insert(medicalRecords).values({ patientId: pA, doctorId, treatmentTypeId: typeA })
      await tx.insert(medicalRecords).values({ patientId: pB, doctorId, treatmentTypeId: typeB })

      const res = await resolveAudience(tx, { treatmentTypeId: typeA })
      const ids = res.recipients.map((r) => r.patientId)
      expect(ids).toContain(pA)
      expect(ids).not.toContain(pB)
      expect(res.count).toBe(res.recipients.length)
    })
  })

  it('tag filter matches patients linked to ANY of the given tags', async () => {
    await withRollback(async (tx) => {
      const tag1 = await makeTag(tx)
      const tag2 = await makeTag(tx)
      const tag3 = await makeTag(tx)

      const p1 = await makeContactablePatient(tx)
      const p2 = await makeContactablePatient(tx)
      const pNone = await makeContactablePatient(tx)

      await tx.insert(patientTagLinks).values({ patientId: p1, tagId: tag1 })
      await tx.insert(patientTagLinks).values({ patientId: p2, tagId: tag2 })

      const res = await resolveAudience(tx, { tagIds: [tag1, tag2, tag3] })
      const ids = res.recipients.map((r) => r.patientId)
      expect(ids).toContain(p1)
      expect(ids).toContain(p2)
      expect(ids).not.toContain(pNone)
    })
  })

  it('ALWAYS excludes do-not-contact patients (§13.3 / §18.1)', async () => {
    await withRollback(async (tx) => {
      const tag = await makeTag(tx)
      const allowed = await makeContactablePatient(tx, { doNotContact: false })
      const optedOut = await makeContactablePatient(tx, { doNotContact: true })
      await tx.insert(patientTagLinks).values({ patientId: allowed, tagId: tag })
      await tx.insert(patientTagLinks).values({ patientId: optedOut, tagId: tag })

      // Opt-out is unconditional — there is no flag a caller can use to disable it.
      const res = await resolveAudience(tx, { tagIds: [tag] })
      const ids = res.recipients.map((r) => r.patientId)
      expect(ids).toContain(allowed)
      expect(ids).not.toContain(optedOut)
    })
  })

  it('filters AND together: treatment-type AND tag', async () => {
    await withRollback(async (tx) => {
      const doctorId = await makeDoctor(tx)
      const type = await makeTreatmentType(tx)
      const tag = await makeTag(tx)

      const both = await makeContactablePatient(tx)
      const typeOnly = await makeContactablePatient(tx)
      const tagOnly = await makeContactablePatient(tx)

      await tx.insert(medicalRecords).values({ patientId: both, doctorId, treatmentTypeId: type })
      await tx.insert(patientTagLinks).values({ patientId: both, tagId: tag })
      await tx
        .insert(medicalRecords)
        .values({ patientId: typeOnly, doctorId, treatmentTypeId: type })
      await tx.insert(patientTagLinks).values({ patientId: tagOnly, tagId: tag })

      const res = await resolveAudience(tx, { treatmentTypeId: type, tagIds: [tag] })
      const ids = res.recipients.map((r) => r.patientId)
      expect(ids).toContain(both)
      expect(ids).not.toContain(typeOnly)
      expect(ids).not.toContain(tagOnly)
    })
  })

  it('follow_up segment matches a patient with an appointment completed 48–72h ago', async () => {
    await withRollback(async (tx) => {
      const doctorId = await makeDoctor(tx)
      const inWindow = await makeContactablePatient(tx)
      const outOfWindow = await makeContactablePatient(tx)

      const now = Date.now()
      const completed60h = new Date(now - 60 * 60 * 60 * 1000) // inside 48–72h
      const completed10h = new Date(now - 10 * 60 * 60 * 1000) // too recent

      await tx.insert(appointments).values({
        patientId: inWindow,
        doctorId,
        date: completed60h,
        status: 'completed',
        type: 'checkup',
        completedAt: completed60h,
      })
      await tx.insert(appointments).values({
        patientId: outOfWindow,
        doctorId,
        date: completed10h,
        status: 'completed',
        type: 'checkup',
        completedAt: completed10h,
      })

      const res = await resolveAudience(tx, { segment: 'follow_up' })
      const ids = res.recipients.map((r) => r.patientId)
      expect(ids).toContain(inWindow)
      expect(ids).not.toContain(outOfWindow)
    })
  })

  it('recare segment matches an active recare plan due within 30 days', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const due = await makeContactablePatient(tx)
      const farOut = await makeContactablePatient(tx)

      const now = Date.now()
      const in10Days = new Date(now + 10 * 24 * 60 * 60 * 1000)
      const in90Days = new Date(now + 90 * 24 * 60 * 60 * 1000)

      const recareBase = {
        scopeType: 'patient' as const,
        durationValue: 6,
        durationUnit: 'months' as const,
        recurrence: 'one_time' as const,
        status: 'pending' as const,
        isActive: true,
        createdById: userId,
      }
      await tx.insert(recarePlans).values({
        ...recareBase,
        patientId: due,
        nextAlertDate: in10Days,
      })
      await tx.insert(recarePlans).values({
        ...recareBase,
        patientId: farOut,
        nextAlertDate: in90Days,
      })

      const res = await resolveAudience(tx, { segment: 'recare' })
      const ids = res.recipients.map((r) => r.patientId)
      expect(ids).toContain(due)
      expect(ids).not.toContain(farOut)
    })
  })

  it('segment "all" applies no segment constraint (still opt-out filtered)', async () => {
    await withRollback(async (tx) => {
      const p = await makeContactablePatient(tx)
      const res = await resolveAudience(tx, { segment: 'all' })
      const ids = res.recipients.map((r) => r.patientId)
      expect(ids).toContain(p)
      // count is internally consistent with the recipient list
      expect(res.count).toBe(res.recipients.length)
    })
  })

  it('recipients carry the {patientId, patientName, phone} shape the send path consumes', async () => {
    await withRollback(async (tx) => {
      const tag = await makeTag(tx)
      const p = await makeContactablePatient(tx, { phone: '+233500111222' })
      await tx.insert(patientTagLinks).values({ patientId: p, tagId: tag })

      const res = await resolveAudience(tx, { tagIds: [tag] })
      const row = res.recipients.find((r) => r.patientId === p)
      expect(row).toBeDefined()
      expect(row?.phone).toBe('+233500111222')
      expect(typeof row?.patientName).toBe('string')
    })
  })
})
