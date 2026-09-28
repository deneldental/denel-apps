/**
 * pending-medical-record-service.ts
 *
 * A "pending medical record" is the doctor's to-do queued when a patient is
 * checked in (walk-in or scheduled) but the clinical note hasn't been written
 * yet. The matching `POST /api/medical-records` flips these to 'completed' when
 * the doctor finally writes the note (see medical-records route).
 *
 * Nothing created these rows before — the front-end's check-in + walk-in flows
 * POST to `/api/medical-records/pending`, but that route never existed, so the
 * call silently 404'd and the queue stayed empty. This fn is that missing path.
 */

import { and, eq, isNull } from 'drizzle-orm'
import type { DB } from '../db'
import { pendingMedicalRecords } from '../db/schema'

export type EnsurePendingInput = {
  patientId: string
  doctorId: string
  appointmentId?: string | null
}

/**
 * Queue a pending medical record. Idempotent: reuses an open pending row for the
 * same patient + doctor (+ appointment when given) so a re-fired check-in — or a
 * walk-in whose FE retries — doesn't clutter the doctor's queue with duplicates.
 */
export async function ensurePendingMedicalRecord(
  db: DB,
  input: EnsurePendingInput
): Promise<typeof pendingMedicalRecords.$inferSelect> {
  const existing = await db.query.pendingMedicalRecords.findFirst({
    where: and(
      eq(pendingMedicalRecords.status, 'pending'),
      eq(pendingMedicalRecords.patientId, input.patientId),
      eq(pendingMedicalRecords.doctorId, input.doctorId),
      input.appointmentId
        ? eq(pendingMedicalRecords.appointmentId, input.appointmentId)
        : isNull(pendingMedicalRecords.appointmentId)
    ),
  })
  if (existing) return existing

  const [created] = await db
    .insert(pendingMedicalRecords)
    .values({
      patientId: input.patientId,
      doctorId: input.doctorId,
      appointmentId: input.appointmentId ?? null,
    })
    .returning()
  return created
}
