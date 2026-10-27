/**
 * Regression test for C1 — no double-booking prevention anywhere.
 *
 * Before this fix, `checkDoctorAvailable` (the one function every booking
 * path calls) only queried `doctor_unavailability` — never the `appointments`
 * table itself. Two different patients could be booked with the same doctor
 * at fully overlapping times, or into the same chair, and nothing anywhere
 * objected. See project-docs/patient-records-and-scheduling-audit.md, C1.
 *
 * Exercises the real overlap SQL against a real Postgres — the interval math
 * (existing.date + existing.durationMinutes) needs a real DB, not a mock.
 */
import { describe, expect, it } from 'vitest'
import {
  checkDoctorAvailable,
  findChairConflict,
  findConflictingAppointment,
} from '../../src/lib/doctor-availability'
import { makeAppointment, makeChair, makeDoctor, makePatient } from './_fixtures'
import { noDb, withRollback } from './_setup'

describe.skipIf(noDb)('findConflictingAppointment [C1]', () => {
  it('finds an overlapping active appointment for the same doctor', async () => {
    await withRollback(async (tx) => {
      const patientId = await makePatient(tx)
      const doctorId = await makeDoctor(tx)
      const start = new Date('2027-01-15T09:00:00Z')
      await makeAppointment(tx, { patientId, doctorId, status: 'scheduled', date: start })

      // A second, different patient proposed at a fully overlapping time.
      const conflict = await findConflictingAppointment(tx, doctorId, start, 30)
      expect(conflict).not.toBeNull()
    })
  })

  it('does not conflict with a back-to-back appointment (end == next start)', async () => {
    await withRollback(async (tx) => {
      const patientId = await makePatient(tx)
      const doctorId = await makeDoctor(tx)
      const start = new Date('2027-01-15T09:00:00Z')
      // Existing: 09:00–09:30 (default 30 min).
      await makeAppointment(tx, { patientId, doctorId, status: 'scheduled', date: start })

      // Proposed: 09:30–10:00 — starts exactly when the existing one ends.
      const proposedStart = new Date('2027-01-15T09:30:00Z')
      const conflict = await findConflictingAppointment(tx, doctorId, proposedStart, 30)
      expect(conflict).toBeNull()
    })
  })

  it.each([
    'completed',
    'cancelled',
    'no_show',
  ])('does not conflict with a terminal (%s) appointment', async (status) => {
    await withRollback(async (tx) => {
      const patientId = await makePatient(tx)
      const doctorId = await makeDoctor(tx)
      const start = new Date('2027-01-15T09:00:00Z')
      await makeAppointment(tx, { patientId, doctorId, status, date: start })

      const conflict = await findConflictingAppointment(tx, doctorId, start, 30)
      expect(conflict).toBeNull()
    })
  })

  it('excludes the appointment being edited from conflicting with itself', async () => {
    await withRollback(async (tx) => {
      const patientId = await makePatient(tx)
      const doctorId = await makeDoctor(tx)
      const start = new Date('2027-01-15T09:00:00Z')
      const appointmentId = await makeAppointment(tx, {
        patientId,
        doctorId,
        status: 'scheduled',
        date: start,
      })

      const conflict = await findConflictingAppointment(tx, doctorId, start, 30, appointmentId)
      expect(conflict).toBeNull()
    })
  })

  it('a different doctor at the same time is not a conflict', async () => {
    await withRollback(async (tx) => {
      const patientId = await makePatient(tx)
      const doctorA = await makeDoctor(tx)
      const doctorB = await makeDoctor(tx)
      const start = new Date('2027-01-15T09:00:00Z')
      await makeAppointment(tx, { patientId, doctorId: doctorA, status: 'scheduled', date: start })

      const conflict = await findConflictingAppointment(tx, doctorB, start, 30)
      expect(conflict).toBeNull()
    })
  })
})

describe.skipIf(noDb)('findChairConflict [C1]', () => {
  it('finds an overlapping active appointment in the same chair (chair conflicts are doctor-independent — findChairConflict takes no doctorId)', async () => {
    await withRollback(async (tx) => {
      const patientId = await makePatient(tx)
      const doctorId = await makeDoctor(tx)
      const chairId = await makeChair(tx)
      const start = new Date('2027-01-15T09:00:00Z')
      await makeAppointment(tx, { patientId, doctorId, status: 'scheduled', date: start, chairId })

      const conflict = await findChairConflict(tx, chairId, start, 30)
      expect(conflict).not.toBeNull()
    })
  })

  it('two different chairs at the same time are not a conflict', async () => {
    await withRollback(async (tx) => {
      const patientId = await makePatient(tx)
      const doctorId = await makeDoctor(tx)
      const chairA = await makeChair(tx, 'IT Chair A')
      const chairB = await makeChair(tx, 'IT Chair B')
      const start = new Date('2027-01-15T09:00:00Z')
      await makeAppointment(tx, {
        patientId,
        doctorId,
        status: 'scheduled',
        date: start,
        chairId: chairA,
      })

      const conflict = await findChairConflict(tx, chairB, start, 30)
      expect(conflict).toBeNull()
    })
  })
})

describe.skipIf(noDb)('checkDoctorAvailable composes all three checks [C1]', () => {
  it('returns a DOCTOR_UNAVAILABLE 409 body for an appointment conflict', async () => {
    await withRollback(async (tx) => {
      const patientId = await makePatient(tx)
      const doctorId = await makeDoctor(tx)
      const start = new Date('2027-01-15T09:00:00Z')
      await makeAppointment(tx, { patientId, doctorId, status: 'confirmed', date: start })

      const result = await checkDoctorAvailable(tx, doctorId, start, 30)
      expect(result?.code).toBe('DOCTOR_UNAVAILABLE')
    })
  })

  it('returns null when nothing conflicts', async () => {
    await withRollback(async (tx) => {
      const doctorId = await makeDoctor(tx)
      const result = await checkDoctorAvailable(tx, doctorId, new Date('2027-01-15T09:00:00Z'), 30)
      expect(result).toBeNull()
    })
  })
})
