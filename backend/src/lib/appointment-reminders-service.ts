import { CLINIC_TIME_ZONE } from '@denel/utils'
import { and, eq, isNull } from 'drizzle-orm'
import { appointmentTypeReminders, patients, scheduledReminders } from '../db/schema'
import { resolveAppointmentTypeId } from './appointment-type-matching'
import { logError } from './logger'
import { sendSMS } from './sms'

/**
 * Syncs the scheduled reminders for a newly created or updated appointment.
 * It will clear any pending reminders for this appointment and recreate them
 * based on the latest configuration.
 */
export async function handleOnBookingReminders(db: any, appointment: any, userId: string) {
  try {
    const apptDate = new Date(appointment.date)

    // 1. Fetch the applicable reminder policies.
    // `appointment.type` is a type NAME; policies are keyed by the type's UUID —
    // see appointment-type-matching.ts. A name with no matching type (website
    // bookings store a service name) resolves to null and falls through to the
    // default policy below, which is the same outcome as an unconfigured type.
    const appointmentTypeId = await resolveAppointmentTypeId(db, appointment.type)

    let policies = appointmentTypeId
      ? await db.query.appointmentTypeReminders.findMany({
          where: and(
            eq(appointmentTypeReminders.appointmentTypeId, appointmentTypeId),
            eq(appointmentTypeReminders.triggerType, 'on_booking'),
            eq(appointmentTypeReminders.isActive, true)
          ),
          with: { template: true },
        })
      : []

    // If none found for the specific type, fallback to default (null)
    if (policies.length === 0) {
      policies = await db.query.appointmentTypeReminders.findMany({
        where: and(
          isNull(appointmentTypeReminders.appointmentTypeId),
          eq(appointmentTypeReminders.triggerType, 'on_booking'),
          eq(appointmentTypeReminders.isActive, true)
        ),
        with: { template: true },
      })
    }

    if (policies.length === 0) return

    // 2. Handle immediate "on_booking" messages
    if (appointment.patientId) {
      const patient = await db.query.patients.findFirst({
        where: eq(patients.id, appointment.patientId),
      })

      if (patient && (patient.phone || (patient.isChild && patient.guardianPhone))) {
        for (const policy of policies) {
          if (!policy.template) continue

          const smsTemplate = policy.template.messageTemplate
          const formattedDate = apptDate.toLocaleDateString('en-GH', { timeZone: CLINIC_TIME_ZONE })
          const formattedTime = apptDate.toLocaleTimeString('en-GH', { timeZone: CLINIC_TIME_ZONE })

          const message = smsTemplate
            .replace(/{Patientname}/gi, patient.name || 'Patient')
            .replace(/{date}/gi, formattedDate)
            .replace(/{time}/gi, formattedTime)

          const contactPhone =
            patient.isChild && patient.guardianPhone ? patient.guardianPhone : patient.phone!

          // Fire and forget
          sendSMS(
            [{ phone: contactPhone, message, patientId: patient.id }],
            undefined,
            'appointment',
            userId
          ).catch((e) => logError(e, { context: 'handleOnBookingReminders sendSMS' }))
        }
      }
    }
  } catch (err) {
    logError(err, { context: 'handleOnBookingReminders' })
  }
}
