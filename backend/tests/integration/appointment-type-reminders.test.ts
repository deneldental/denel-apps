/**
 * Appointment-type reminder matching.
 *
 * Regression cover for the id/name mismatch: reminder policies are keyed by
 * `appointment_types.id` (UUID), but `appointments.type` stores the type NAME.
 * The reminder code compared the two directly, so the on-booking path threw
 * 22P02 on every appointment and the scheduler's per-type policies could never
 * match a row. `src/lib/appointment-type-matching.ts` is the translation layer.
 *
 * Run with `doppler run -- pnpm --filter backend test` (or against the local
 * Postgres via `node scripts/dev-local.mjs pnpm test`); `pnpm test` alone skips.
 */

import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { DB } from '../../src/db'
import {
  appointments,
  appointmentTypeReminders,
  appointmentTypes,
  doctors,
  reminderTemplates,
} from '../../src/db/schema'
import {
  excludesAppointmentTypeNames,
  matchesAppointmentTypeName,
  resolveAppointmentTypeId,
  resolveAppointmentTypeNames,
} from '../../src/lib/appointment-type-matching'
import { makePatient, makeSpecialist } from './_fixtures'
import { expectRejection, noDb, withRollback } from './_setup'

/** A type name unique per run so a rolled-back sibling can never collide. */
function uniqueTypeName(label: string): string {
  return `${label}-it-${randomUUID().slice(0, 8)}`
}

async function makeAppointmentType(tx: DB, name: string): Promise<string> {
  const [row] = await tx.insert(appointmentTypes).values({ name }).returning()
  return row.id
}

/**
 * A doctor of our own, inside the rolled-back transaction. This used to borrow
 * any existing row from `doctors`, so the suite failed on a fresh database —
 * which is exactly what a new environment or CI starts from. A doctor must link
 * exactly one of a user or a specialist (doctors_source_xor).
 */
async function makeDoctor(tx: DB): Promise<string> {
  const [row] = await tx
    .insert(doctors)
    .values({ specialistId: await makeSpecialist(tx), specialty: 'General Dentistry' })
    .returning()
  return row.id
}

async function makeAppointment(tx: DB, type: string): Promise<string> {
  const [row] = await tx
    .insert(appointments)
    .values({
      patientId: await makePatient(tx, 'Reminder IT Patient'),
      doctorId: await makeDoctor(tx),
      date: new Date(Date.now() + 24 * 60 * 60 * 1000),
      status: 'scheduled',
      type,
    })
    .returning()
  return row.id
}

describe.skipIf(noDb)('appointment type ↔ reminder policy matching', () => {
  it('resolves the name stored on an appointment to the type id', async () => {
    await withRollback(async (tx) => {
      const name = uniqueTypeName('Consultation')
      const typeId = await makeAppointmentType(tx, name)

      expect(await resolveAppointmentTypeId(tx, name)).toBe(typeId)
      // Every appointment writer sends `appointmentTypes.name` verbatim, but the
      // hardcoded 'consultation' fallbacks do not guarantee the casing.
      expect(await resolveAppointmentTypeId(tx, name.toUpperCase())).toBe(typeId)
      expect(await resolveAppointmentTypeId(tx, `  ${name}  `)).toBe(typeId)
    })
  })

  it('returns null for a name with no type, so the caller falls back to the default policy', async () => {
    await withRollback(async (tx) => {
      // website-bookings stores `booking.service` in `appointments.type` — a
      // service name that legitimately matches no appointment type.
      expect(await resolveAppointmentTypeId(tx, 'a-service-not-a-type')).toBeNull()
      expect(await resolveAppointmentTypeId(tx, '')).toBeNull()
      expect(await resolveAppointmentTypeId(tx, null)).toBeNull()
    })
  })

  it('passes an id straight through', async () => {
    await withRollback(async (tx) => {
      const id = randomUUID()
      expect(await resolveAppointmentTypeId(tx, id)).toBe(id)
    })
  })

  it('finds the policy for a booked appointment (the query that used to throw)', async () => {
    await withRollback(async (tx) => {
      const name = uniqueTypeName('Checkup')
      const typeId = await makeAppointmentType(tx, name)
      const [template] = await tx
        .insert(reminderTemplates)
        .values({ name: 'IT template', messageTemplate: 'Hi {firstName}' })
        .returning()
      await tx.insert(appointmentTypeReminders).values({
        appointmentTypeId: typeId,
        triggerType: 'on_booking',
        templateId: template.id,
      })

      // What handleOnBookingReminders now does: resolve, then match on the id.
      const resolved = await resolveAppointmentTypeId(tx, name)
      if (!resolved) throw new Error(`'${name}' did not resolve to an appointment type`)

      const found = await tx
        .select()
        .from(appointmentTypeReminders)
        .where(
          and(
            eq(appointmentTypeReminders.appointmentTypeId, resolved),
            eq(appointmentTypeReminders.triggerType, 'on_booking')
          )
        )

      expect(found).toHaveLength(1)
    })
  })

  it('rejects the old direct comparison of the uuid column against a type name', async () => {
    const err = await expectRejection((tx) =>
      tx
        .select()
        .from(appointmentTypeReminders)
        .where(eq(appointmentTypeReminders.appointmentTypeId, 'consultation'))
    )

    // Drizzle wraps the driver error, so the SQLSTATE is on the cause:
    // 22P02 invalid_text_representation — 'consultation' is not a uuid. This is
    // the error the on-booking path raised for every appointment ever booked.
    expect((err.cause as { code?: string } | undefined)?.code).toBe('22P02')
  })

  it('maps policy type ids back to the names appointments are stored under', async () => {
    await withRollback(async (tx) => {
      const name = uniqueTypeName('Procedure')
      const typeId = await makeAppointmentType(tx, name)

      const namesById = await resolveAppointmentTypeNames(tx, [typeId, typeId])
      expect(namesById.get(typeId)).toBe(name)
      // An id with no surviving type is absent rather than mapped to undefined-ish.
      expect(namesById.has(randomUUID())).toBe(false)
      expect(await resolveAppointmentTypeNames(tx, [])).toEqual(new Map())
    })
  })

  it('matches appointments by type name, whatever the casing', async () => {
    await withRollback(async (tx) => {
      const name = uniqueTypeName('Cleaning')
      const matchingId = await makeAppointment(tx, name.toUpperCase())
      await makeAppointment(tx, uniqueTypeName('Other'))

      const rows = await tx
        .select({ id: appointments.id })
        .from(appointments)
        .where(matchesAppointmentTypeName(name))

      expect(rows.map((r) => r.id)).toEqual([matchingId])
    })
  })

  it('excludes explicitly configured types from the default policy', async () => {
    await withRollback(async (tx) => {
      const configured = uniqueTypeName('Configured')
      const unconfigured = uniqueTypeName('Unconfigured')
      const configuredApptId = await makeAppointment(tx, configured)
      const unconfiguredApptId = await makeAppointment(tx, unconfigured)

      const condition = excludesAppointmentTypeNames([configured])
      const rows = await tx.select({ id: appointments.id }).from(appointments).where(condition)

      const ids = rows.map((r) => r.id)
      expect(ids).toContain(unconfiguredApptId)
      expect(ids).not.toContain(configuredApptId)

      // Nothing configured → no filter at all, so the default policy covers every
      // appointment rather than none.
      expect(excludesAppointmentTypeNames([])).toBeUndefined()
    })
  })
})
