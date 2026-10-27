/**
 * Regression test for H3 — `processAppointmentTypeReminders` had no
 * idempotency guard at all; its own comment admitted "this could double-fire
 * if the scheduler is rerun manually within 15 mins." See
 * project-docs/patient-records-and-scheduling-audit.md, H3.
 *
 * Exercises the real function against a real Postgres — the window query and
 * the `appointment_type_reminder_sends` unique-index dedupe both need a real
 * DB, not a mock.
 */
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DB } from '../../src/db'
import {
  appointments,
  appointmentTypeReminderSends,
  appointmentTypeReminders,
  patients,
  reminderTemplates,
} from '../../src/db/schema'

vi.mock('../../src/lib/sms', () => ({
  sendSMS: vi.fn(async () => ({ success: true })),
}))

import { eq } from 'drizzle-orm'
import { processAppointmentTypeReminders } from '../../src/lib/scheduler'
import { sendSMS } from '../../src/lib/sms'
import { makeDoctor, makePatient } from './_fixtures'
import { noDb, withRollback } from './_setup'

const mockSendSMS = vi.mocked(sendSMS)

/** A patient with a phone — `makePatient` doesn't set one, and only patients
 *  with a phone are ever candidates for an SMS reminder. */
async function makePatientWithPhone(tx: DB): Promise<string> {
  const id = await makePatient(tx, 'Reminder IT Patient')
  await tx.update(patients).set({ phone: '+233241234567' }).where(eq(patients.id, id))
  return id
}

async function makeReminderPolicy(
  tx: DB,
  offsetHours: number
): Promise<{ policyId: string; templateId: string }> {
  const [template] = await tx
    .insert(reminderTemplates)
    .values({
      name: `IT template ${randomUUID().slice(0, 8)}`,
      messageTemplate: 'Hi {patientName}',
    })
    .returning()
  const [policy] = await tx
    .insert(appointmentTypeReminders)
    .values({
      appointmentTypeId: null, // default policy — applies to every unconfigured type
      triggerType: 'before_appointment',
      offsetHours,
      templateId: template.id,
      isActive: true,
    })
    .returning()
  return { policyId: policy.id, templateId: template.id }
}

async function makeUpcomingAppointment(
  tx: DB,
  patientId: string,
  doctorId: string,
  offsetHours: number
): Promise<string> {
  const [row] = await tx
    .insert(appointments)
    .values({
      patientId,
      doctorId,
      // Inside the [now + offset - 15min, now + offset] window the function computes.
      date: new Date(Date.now() + offsetHours * 60 * 60 * 1000 - 5 * 60 * 1000),
      status: 'scheduled',
      type: 'consultation',
    })
    .returning()
  return row.id
}

describe.skipIf(noDb)('processAppointmentTypeReminders [H3]', () => {
  afterEach(() => vi.clearAllMocks())

  it('sends once and records the send', async () => {
    await withRollback(async (tx) => {
      const patientId = await makePatientWithPhone(tx)
      const doctorId = await makeDoctor(tx)
      const { policyId } = await makeReminderPolicy(tx, 24)
      const appointmentId = await makeUpcomingAppointment(tx, patientId, doctorId, 24)

      await processAppointmentTypeReminders(tx, new Date())

      expect(mockSendSMS).toHaveBeenCalledTimes(1)
      const sends = await tx
        .select()
        .from(appointmentTypeReminderSends)
        .where(eq(appointmentTypeReminderSends.appointmentId, appointmentId))
      expect(sends).toHaveLength(1)
      expect(sends[0].policyId).toBe(policyId)
    })
  })

  it('does not send a second time on a re-run against the same window', async () => {
    await withRollback(async (tx) => {
      const patientId = await makePatientWithPhone(tx)
      const doctorId = await makeDoctor(tx)
      await makeReminderPolicy(tx, 24)
      await makeUpcomingAppointment(tx, patientId, doctorId, 24)

      const now = new Date()
      await processAppointmentTypeReminders(tx, now)
      expect(mockSendSMS).toHaveBeenCalledTimes(1)

      // The exact scenario the original code's comment admitted: the scheduler
      // is rerun (manually, or an overlapping tick) against the same window.
      await processAppointmentTypeReminders(tx, now)
      expect(mockSendSMS).toHaveBeenCalledTimes(1)
    })
  })

  it('still sends to a different appointment under the same policy', async () => {
    await withRollback(async (tx) => {
      const doctorId = await makeDoctor(tx)
      const { policyId } = await makeReminderPolicy(tx, 24)

      const patientA = await makePatientWithPhone(tx)
      const apptA = await makeUpcomingAppointment(tx, patientA, doctorId, 24)
      const now = new Date()
      await processAppointmentTypeReminders(tx, now)
      expect(mockSendSMS).toHaveBeenCalledTimes(1)

      // A second, different appointment under the same policy in the same
      // tick must still go out — the dedupe is per-appointment, not per-policy.
      const patientB = await makePatientWithPhone(tx)
      const apptB = await makeUpcomingAppointment(tx, patientB, doctorId, 24)
      await processAppointmentTypeReminders(tx, now)
      expect(mockSendSMS).toHaveBeenCalledTimes(2)

      const sends = await tx
        .select({ appointmentId: appointmentTypeReminderSends.appointmentId })
        .from(appointmentTypeReminderSends)
        .where(eq(appointmentTypeReminderSends.policyId, policyId))
      const sentIds = sends.map((s) => s.appointmentId)
      expect(sentIds).toContain(apptA)
      expect(sentIds).toContain(apptB)
    })
  })
})
