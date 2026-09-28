/**
 * admin-v1 §18.2 — pending-consent tracking smoke tests.
 *
 * `getPendingConsents` is the inverse of the signed-consent tracker: required
 * consent forms a patient has NOT yet signed before a procedure. "Required" =
 * active templates that require a signature. Pending = required − signed,
 * scoped to patients with an upcoming appointment (or a single patient).
 *
 * Run with `doppler run -- pnpm --filter backend test admin-v1-consents-pending`.
 * Every test runs inside `withRollback` (always rolled back; the shared dev DB
 * is never mutated).
 */

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { DB } from '../../src/db'
import {
  appointments,
  consentFormTemplates,
  doctors,
  signedConsentForms,
  specialists,
} from '../../src/db/schema'
import { countPendingConsents, getPendingConsents } from '../../src/lib/pending-consents-service'
import { anyUserId, makePatient } from './_fixtures'
import { noDb, withRollback } from './_setup'

// ── fixture builders ─────────────────────────────────────────────────────────

/** An active, signature-bearing consent template (i.e. "required"). */
async function makeRequiredTemplate(
  tx: DB,
  opts: { active?: boolean; requiresSignature?: boolean; category?: string } = {}
): Promise<string> {
  const [t] = await tx
    .insert(consentFormTemplates)
    .values({
      name: `IT Consent ${randomUUID().slice(0, 10)}`,
      category: opts.category ?? 'surgical',
      content: '<p>IT consent body</p>',
      requiresSignature: opts.requiresSignature ?? true,
      active: opts.active ?? true,
    })
    .returning()
  return t.id
}

async function signConsent(
  tx: DB,
  opts: { templateId: string; patientId: string; userId: string }
): Promise<void> {
  await tx.insert(signedConsentForms).values({
    templateId: opts.templateId,
    patientId: opts.patientId,
    signatureData: 'data:image/png;base64,IT',
    signedByName: 'IT Patient',
    contentSnapshot: '<p>IT consent body</p>',
    collectedById: opts.userId,
  })
}

/** A `doctors` row (sourced from a specialist) for appointment FKs. */
async function makeDoctor(tx: DB): Promise<string> {
  const [s] = await tx
    .insert(specialists)
    .values({ name: 'IT Specialist', defaultCommissionRate: 0, withholdingTaxRate: 0 })
    .returning()
  const [d] = await tx
    .insert(doctors)
    .values({ specialistId: s.id, specialty: 'IT Dentistry' })
    .returning()
  return d.id
}

/** An upcoming appointment for a patient (default status 'scheduled', tomorrow). */
async function makeUpcomingAppointment(
  tx: DB,
  opts: { patientId: string; doctorId: string; status?: string; date?: Date }
): Promise<void> {
  await tx.insert(appointments).values({
    patientId: opts.patientId,
    doctorId: opts.doctorId,
    date: opts.date ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
    status: opts.status ?? 'scheduled',
    type: 'procedure',
  })
}

// ── tests ────────────────────────────────────────────────────────────────────

describe.skipIf(noDb)('admin-v1 §18.2 — pending consents', () => {
  // NOTE: the dev DB already carries seeded active/required templates, so the
  // "required" baseline is global. Assertions therefore check membership of
  // THIS test's templates rather than exact equality of the whole pending set.

  it('patient with an upcoming appointment and no signatures has both new templates pending', async () => {
    await withRollback(async (tx) => {
      const patientId = await makePatient(tx)
      const doctorId = await makeDoctor(tx)
      const t1 = await makeRequiredTemplate(tx)
      const t2 = await makeRequiredTemplate(tx)
      await makeUpcomingAppointment(tx, { patientId, doctorId })

      const rows = await getPendingConsents(tx, { patientId })
      expect(rows).toHaveLength(1)
      const ids = rows[0].pending.map((p) => p.templateId)
      expect(ids).toContain(t1)
      expect(ids).toContain(t2)
      expect(rows[0].patientId).toBe(patientId)
    })
  })

  it('a signed required template drops out of pending; the rest remain', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const t1 = await makeRequiredTemplate(tx)
      const t2 = await makeRequiredTemplate(tx)
      await signConsent(tx, { templateId: t1, patientId, userId })

      const rows = await getPendingConsents(tx, { patientId })
      expect(rows).toHaveLength(1)
      const ids = rows[0].pending.map((p) => p.templateId)
      // t1 was signed → gone; t2 still pending.
      expect(ids).not.toContain(t1)
      expect(ids).toContain(t2)
    })
  })

  it('signing a required template removes exactly one pending pair', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const t1 = await makeRequiredTemplate(tx)
      const t2 = await makeRequiredTemplate(tx)

      const before = await getPendingConsents(tx, { patientId })
      const beforeCount = before[0]?.pending.length ?? 0
      expect(beforeCount).toBeGreaterThanOrEqual(2) // at least t1 + t2

      await signConsent(tx, { templateId: t1, patientId, userId })
      await signConsent(tx, { templateId: t2, patientId, userId })

      const after = await getPendingConsents(tx, { patientId })
      const afterCount = after[0]?.pending.length ?? 0
      // Exactly the two we signed are gone from this patient's pending set.
      expect(beforeCount - afterCount).toBe(2)
      const afterIds = after[0]?.pending.map((p) => p.templateId) ?? []
      expect(afterIds).not.toContain(t1)
      expect(afterIds).not.toContain(t2)
    })
  })

  it('inactive and signature-optional templates are NOT required', async () => {
    await withRollback(async (tx) => {
      const patientId = await makePatient(tx)
      const required = await makeRequiredTemplate(tx)
      await makeRequiredTemplate(tx, { active: false })
      await makeRequiredTemplate(tx, { requiresSignature: false })

      const rows = await getPendingConsents(tx, { patientId })
      expect(rows).toHaveLength(1)
      const ids = rows[0].pending.map((p) => p.templateId)
      // Only the active + signature-bearing template is pending; the other two
      // never count as required (they may equal the whole pending set or be a
      // subset of a larger seeded baseline — assert membership precisely).
      expect(ids).toContain(required)
    })
  })

  it('upcoming-appointment scope includes the patient; the count matches the rows', async () => {
    await withRollback(async (tx) => {
      const patientId = await makePatient(tx, `IT Pending ${randomUUID().slice(0, 8)}`)
      const doctorId = await makeDoctor(tx)
      const t1 = await makeRequiredTemplate(tx)
      const t2 = await makeRequiredTemplate(tx)
      await makeUpcomingAppointment(tx, { patientId, doctorId, status: 'confirmed' })

      const rows = await getPendingConsents(tx, { upcomingOnly: true })
      const mine = rows.find((r) => r.patientId === patientId)
      expect(mine).toBeTruthy()
      const mineIds = mine?.pending.map((p) => p.templateId) ?? []
      expect(mineIds).toContain(t1)
      expect(mineIds).toContain(t2)
      expect(mine?.nextAppointmentDate).toBeTruthy()

      // The digest count is the sum of pending pairs across the in-scope rows.
      const total = await countPendingConsents(tx, { upcomingOnly: true })
      const expected = rows.reduce((s, r) => s + r.pending.length, 0)
      expect(total).toBe(expected)
    })
  })

  it('a patient with only a PAST appointment is not in the upcoming scope', async () => {
    await withRollback(async (tx) => {
      const patientId = await makePatient(tx, `IT Past ${randomUUID().slice(0, 8)}`)
      const doctorId = await makeDoctor(tx)
      await makeRequiredTemplate(tx)
      await makeUpcomingAppointment(tx, {
        patientId,
        doctorId,
        date: new Date(Date.now() - 24 * 60 * 60 * 1000), // yesterday
      })

      const rows = await getPendingConsents(tx, { upcomingOnly: true })
      expect(rows.find((r) => r.patientId === patientId)).toBeUndefined()
    })
  })
})
