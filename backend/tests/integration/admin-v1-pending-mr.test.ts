/**
 * Pending-medical-record smoke tests — covers the previously-missing creation
 * path (`ensurePendingMedicalRecord`, behind POST /api/medical-records/pending).
 * Before this, nothing ever inserted a pending_medical_records row, so the
 * doctor's check-in queue stayed permanently empty.
 *
 * Run with `doppler run -- pnpm --filter backend test`. Every test runs inside
 * `withRollback` (always rolled back; the shared dev DB is never mutated).
 */

import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { DB } from '../../src/db'
import { appointments, doctors, pendingMedicalRecords } from '../../src/db/schema'
import { ensurePendingMedicalRecord } from '../../src/lib/pending-medical-record-service'
import { makePatient, makeSpecialist } from './_fixtures'
import { noDb, withRollback } from './_setup'

/** A `doctors` row sourced from a specialist (satisfies the source-XOR check). */
async function makeDoctor(tx: DB, specialistId: string): Promise<string> {
  const [d] = await tx
    .insert(doctors)
    .values({ specialistId, specialty: 'IT Dentistry' })
    .returning()
  return d.id
}

async function makeAppointment(tx: DB, patientId: string, doctorId: string): Promise<string> {
  const [a] = await tx
    .insert(appointments)
    .values({
      patientId,
      doctorId,
      date: new Date(),
      status: 'checked_in',
      type: 'consultation',
    })
    .returning()
  return a.id
}

describe.skipIf(noDb)('admin-v1 — pending medical record on check-in', () => {
  it('creates a pending record for a checked-in patient', async () => {
    await withRollback(async (tx) => {
      const patientId = await makePatient(tx)
      const doctorId = await makeDoctor(tx, await makeSpecialist(tx))

      const rec = await ensurePendingMedicalRecord(tx, { patientId, doctorId })
      expect(rec.id).toBeTruthy()
      expect(rec.status).toBe('pending')
      expect(rec.patientId).toBe(patientId)
      expect(rec.doctorId).toBe(doctorId)
    })
  })

  it('is idempotent — a re-fired check-in reuses the open pending row', async () => {
    await withRollback(async (tx) => {
      const patientId = await makePatient(tx)
      const doctorId = await makeDoctor(tx, await makeSpecialist(tx))

      const first = await ensurePendingMedicalRecord(tx, { patientId, doctorId })
      const second = await ensurePendingMedicalRecord(tx, { patientId, doctorId })
      expect(second.id).toBe(first.id)

      const rows = await tx.query.pendingMedicalRecords.findMany({
        where: and(
          eq(pendingMedicalRecords.patientId, patientId),
          eq(pendingMedicalRecords.doctorId, doctorId)
        ),
      })
      expect(rows.length).toBe(1)
    })
  })

  it('dedups on the appointment when one is supplied', async () => {
    await withRollback(async (tx) => {
      const patientId = await makePatient(tx)
      const doctorId = await makeDoctor(tx, await makeSpecialist(tx))
      const appointmentId = await makeAppointment(tx, patientId, doctorId)

      const first = await ensurePendingMedicalRecord(tx, { patientId, doctorId, appointmentId })
      const second = await ensurePendingMedicalRecord(tx, { patientId, doctorId, appointmentId })
      expect(first.appointmentId).toBe(appointmentId)
      expect(second.id).toBe(first.id)
    })
  })
})
