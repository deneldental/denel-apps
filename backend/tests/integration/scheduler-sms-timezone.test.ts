/**
 * "No timezone safety net" audit finding (patient-records-and-scheduling-audit.md,
 * targeted-fix pass): `processAppointmentTypeReminders`'s SMS date/time text was
 * built with `toLocaleDateString('en-GH', {...})`/`toLocaleTimeString('en-GH', {...})`
 * and no `timeZone` option — it rendered in whichever timezone the Node process
 * happened to be running in, not the clinic's (Africa/Accra, UTC+0). Proves the
 * fix by running under a server TZ that disagrees with Accra about the calendar
 * day for the appointment instant used, and checking the actual SMS text sent.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DB } from '../../src/db'
import {
  appointments,
  appointmentTypeReminders,
  patients,
  reminderTemplates,
} from '../../src/db/schema'

vi.mock('../../src/lib/sms', () => ({
  sendSMS: vi.fn(async () => ({ success: true })),
}))

import { processAppointmentTypeReminders } from '../../src/lib/scheduler'
import { sendSMS } from '../../src/lib/sms'
import { makeDoctor, makePatient } from './_fixtures'
import { noDb, withRollback } from './_setup'

const mockSendSMS = vi.mocked(sendSMS)

async function makePatientWithPhone(tx: DB): Promise<string> {
  const id = await makePatient(tx, 'TZ Reminder IT Patient')
  await tx.update(patients).set({ phone: '+233241234567' }).where(eq(patients.id, id))
  return id
}

describe.skipIf(noDb)(
  'before_appointment reminder SMS text is anchored to clinic time [Medium]',
  () => {
    const originalTZ = process.env.TZ

    beforeEach(() => {
      // Etc/GMT+12 = UTC-12, a fixed-offset zone (no DST) chosen because it
      // disagrees with Accra (UTC+0) about the calendar day around the
      // appointment instant used below.
      process.env.TZ = 'Etc/GMT+12'
    })

    afterEach(() => {
      process.env.TZ = originalTZ
      vi.clearAllMocks()
    })

    it('renders the Accra calendar day, not the server-local one', async () => {
      await withRollback(async (tx) => {
        const patientId = await makePatientWithPhone(tx)
        const doctorId = await makeDoctor(tx)

        const [template] = await tx
          .insert(reminderTemplates)
          .values({
            name: `TZ IT template ${randomUUID().slice(0, 8)}`,
            messageTemplate:
              'Hi {patientName}, your appt is {appointmentDate} at {appointmentTime}',
          })
          .returning()
        await tx.insert(appointmentTypeReminders).values({
          appointmentTypeId: null,
          triggerType: 'before_appointment',
          offsetHours: 24,
          templateId: template.id,
          isActive: true,
        })

        // now = 2026-09-29T00:10:00Z → window = [now+24h-15min, now+24h] =
        // [2026-09-29T23:55:00Z, 2026-09-30T00:10:00Z].
        const now = new Date('2026-09-29T00:10:00Z')
        // 2026-09-30T00:05Z: 00:05 on Sept 30 in Accra (UTC+0), but 12:05 on
        // Sept 29 in Etc/GMT+12 (UTC-12) — the old server-local formatting
        // would have rendered "29 Sep", not the correct "30 Sep".
        const appointmentDate = new Date('2026-09-30T00:05:00Z')

        await tx.insert(appointments).values({
          patientId,
          doctorId,
          date: appointmentDate,
          status: 'scheduled',
          type: 'consultation',
        })

        await processAppointmentTypeReminders(tx, now)

        expect(mockSendSMS).toHaveBeenCalledTimes(1)
        const [recipients] = mockSendSMS.mock.calls[0]
        const message = recipients[0].message
        expect(message).toContain('30 Sep')
        expect(message).not.toContain('29 Sep')
      })
    })
  }
)
