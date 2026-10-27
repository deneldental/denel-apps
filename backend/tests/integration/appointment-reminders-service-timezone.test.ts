/**
 * "No timezone safety net" audit finding (patient-records-and-scheduling-audit.md,
 * targeted-fix pass): `handleOnBookingReminders`'s SMS date/time text was built
 * with `apptDate.toLocaleDateString()`/`toLocaleTimeString()` — no locale, no
 * `timeZone` option — so it rendered in whichever timezone (and ICU default
 * locale) the Node process happened to be running in, not the clinic's
 * (Africa/Accra, UTC+0). Proves the fix under a server TZ that disagrees with
 * Accra about the calendar day for the appointment instant used.
 */
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DB } from '../../src/db'
import { appointmentTypeReminders, appointmentTypes, reminderTemplates } from '../../src/db/schema'

vi.mock('../../src/lib/sms', () => ({
  sendSMS: vi.fn(async () => ({ success: true })),
}))

import { handleOnBookingReminders } from '../../src/lib/appointment-reminders-service'
import { sendSMS } from '../../src/lib/sms'
import { anyUserId, makePatient } from './_fixtures'
import { noDb, withRollback } from './_setup'

const mockSendSMS = vi.mocked(sendSMS)

async function makePatientWithPhone(tx: DB): Promise<string> {
  const id = await makePatient(tx, 'On-Booking TZ IT Patient')
  const { patients } = await import('../../src/db/schema')
  const { eq } = await import('drizzle-orm')
  await tx.update(patients).set({ phone: '+233241234568' }).where(eq(patients.id, id))
  return id
}

describe.skipIf(noDb)('on-booking reminder SMS text is anchored to clinic time [Medium]', () => {
  const originalTZ = process.env.TZ

  beforeEach(() => {
    // Etc/GMT+12 = UTC-12, a fixed-offset zone (no DST) that disagrees with
    // Accra (UTC+0) about the calendar day for the instant used below.
    process.env.TZ = 'Etc/GMT+12'
  })

  afterEach(() => {
    process.env.TZ = originalTZ
    vi.clearAllMocks()
  })

  it('renders the Accra calendar day, not the server-local one', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatientWithPhone(tx)
      const typeName = `TZ IT Checkup ${randomUUID().slice(0, 8)}`
      const [type] = await tx
        .insert(appointmentTypes)
        .values({ name: typeName })
        .returning({ id: appointmentTypes.id })
      const [template] = await tx
        .insert(reminderTemplates)
        .values({
          name: `TZ IT on-booking template ${randomUUID().slice(0, 8)}`,
          messageTemplate: 'Hi {Patientname}, see you {date} at {time}',
        })
        .returning({ id: reminderTemplates.id })
      await tx.insert(appointmentTypeReminders).values({
        appointmentTypeId: type.id,
        triggerType: 'on_booking',
        templateId: template.id,
      })

      // 2026-09-30T00:05Z: 00:05 on Sept 30 in Accra (UTC+0), but 12:05pm on
      // Sept 29 in Etc/GMT+12 (UTC-12) — the old naive formatting would have
      // rendered "29/09/2026", not the correct "30/09/2026".
      const appointmentDate = new Date('2026-09-30T00:05:00Z')

      await handleOnBookingReminders(
        tx,
        { patientId, date: appointmentDate, type: typeName },
        userId
      )

      expect(mockSendSMS).toHaveBeenCalledTimes(1)
      const [recipients] = mockSendSMS.mock.calls[0]
      const message = recipients[0].message
      expect(message).toContain('30/09/2026')
      expect(message).not.toContain('29/09/2026')
    })
  })
})
