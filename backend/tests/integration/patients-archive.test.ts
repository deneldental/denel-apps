/**
 * Regression test for C5 — patient records had no soft-delete.
 *
 * Before this fix, `DELETE /api/patients/:id` hard-deleted the row with no
 * way back, cascading through every appointment, invoice, payment, medical
 * record and timeline entry for that patient. See
 * project-docs/patient-records-and-scheduling-audit.md, finding C5.
 *
 * This exercises the two things that need a real Postgres, not a mock:
 *  - the `archived` boolean actually partitions a list query the way
 *    `GET /api/patients` now relies on (archived=false / archived=true), and
 *  - the FK cascade every child table declares (`onDelete: 'cascade'`)
 *    actually removes every dependent row when a patient is truly deleted —
 *    the assumption `DELETE /:id/permanent` relies on instead of manually
 *    fanning out deletes the way `invoices.ts`'s permanent-delete does.
 */
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { appointments, medicalRecords, patients, patientTimeline } from '../../src/db/schema'
import { anyUserId, makeAppointment, makeDoctor, makePatient } from './_fixtures'
import { noDb, withRollback } from './_setup'

describe.skipIf(noDb)('patients.archived [C5]', () => {
  it('defaults every new patient to archived=false', async () => {
    await withRollback(async (tx) => {
      const patientId = await makePatient(tx)
      const [row] = await tx.select().from(patients).where(eq(patients.id, patientId))
      expect(row.archived).toBe(false)
      expect(row.archivedAt).toBeNull()
      expect(row.archivedBy).toBeNull()
    })
  })

  it('an archived patient is excluded from an archived=false list query', async () => {
    await withRollback(async (tx) => {
      const activeId = await makePatient(tx, 'Active Patient')
      const archivedId = await makePatient(tx, 'Archived Patient')
      await tx
        .update(patients)
        .set({ archived: true, archivedAt: new Date() })
        .where(eq(patients.id, archivedId))

      const visible = await tx
        .select({ id: patients.id })
        .from(patients)
        .where(and(eq(patients.archived, false)))

      const visibleIds = visible.map((r) => r.id)
      expect(visibleIds).toContain(activeId)
      expect(visibleIds).not.toContain(archivedId)
    })
  })

  it('an archived patient appears in an archived=true list query, and only that one', async () => {
    await withRollback(async (tx) => {
      const activeId = await makePatient(tx, 'Active Patient 2')
      const archivedId = await makePatient(tx, 'Archived Patient 2')
      await tx
        .update(patients)
        .set({ archived: true, archivedAt: new Date() })
        .where(eq(patients.id, archivedId))

      const archivedRows = await tx
        .select({ id: patients.id })
        .from(patients)
        .where(and(eq(patients.archived, true)))

      const archivedIds = archivedRows.map((r) => r.id)
      expect(archivedIds).toContain(archivedId)
      expect(archivedIds).not.toContain(activeId)
    })
  })

  it('unarchiving clears archivedAt/archivedBy and restores default visibility', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      await tx
        .update(patients)
        .set({ archived: true, archivedAt: new Date(), archivedBy: userId })
        .where(eq(patients.id, patientId))

      await tx
        .update(patients)
        .set({ archived: false, archivedAt: null, archivedBy: null })
        .where(eq(patients.id, patientId))

      const [row] = await tx.select().from(patients).where(eq(patients.id, patientId))
      expect(row.archived).toBe(false)
      expect(row.archivedAt).toBeNull()
      expect(row.archivedBy).toBeNull()
    })
  })

  it('deleting a patient cascades to appointments, medical records and timeline entries', async () => {
    await withRollback(async (tx) => {
      const patientId = await makePatient(tx)
      const doctorId = await makeDoctor(tx)
      const appointmentId = await makeAppointment(tx, { patientId, doctorId })
      const [record] = await tx
        .insert(medicalRecords)
        .values({ patientId, doctorId, complaint: 'IT complaint' })
        .returning()
      const [timelineEntry] = await tx
        .insert(patientTimeline)
        .values({ patientId, eventType: 'note', title: 'IT timeline entry' })
        .returning()

      await tx.delete(patients).where(eq(patients.id, patientId))

      const [remainingAppointment] = await tx
        .select()
        .from(appointments)
        .where(eq(appointments.id, appointmentId))
      const [remainingRecord] = await tx
        .select()
        .from(medicalRecords)
        .where(eq(medicalRecords.id, record.id))
      const [remainingTimeline] = await tx
        .select()
        .from(patientTimeline)
        .where(eq(patientTimeline.id, timelineEntry.id))

      expect(remainingAppointment).toBeUndefined()
      expect(remainingRecord).toBeUndefined()
      expect(remainingTimeline).toBeUndefined()
    })
  })
})
