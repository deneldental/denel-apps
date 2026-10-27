/**
 * Check a patient in: one transaction, all or nothing (decision D6, F09/F10/F11/F18).
 *
 * Checking in with a payment used to be two browser requests: record the payment,
 * then flip the status. When the second failed the money stayed with no visit
 * attached, the screen said "success", and the Check In button came back (a second
 * payment). The payment never named its visit, and a booked patient's check-in
 * never queued the doctor's note. Here the visit is locked, and the payment, the
 * status change and the doctor's note either all commit or none do.
 *
 * Retrying is safe by construction. The row lock makes a double-click wait for the
 * first request, and by then the visit is already checked in, so the second request
 * is answered as "already checked in" and takes no money: there is no way for a
 * second request to charge the patient again.
 *
 * Audit entries, the calendar sync and the receipt SMS are NOT in the transaction:
 * a failed statement would poison it, and none of them may undo a check-in.
 */
import { DrizzleQueryError, eq } from 'drizzle-orm'
import type { DB } from '../db'
import { appointments, type payments } from '../db/schema'
import {
  canChangeStatus,
  isPreArrivalStatus,
  pastDayDecision,
  TERMINAL_APPOINTMENT_STATUSES,
} from './appointment-status'
import type { PaymentMethod } from './channel-accounts'
import { errMessage } from './error-message'
import { recordLegacyPayment } from './payment-service'
import { ensurePendingMedicalRecord } from './pending-medical-record-service'

export class CheckInError extends Error {
  constructor(
    readonly httpStatus: 400 | 403 | 404 | 409,
    readonly body: { error: string; code: string }
  ) {
    super(body.error)
    this.name = 'CheckInError'
  }
}

export interface CheckInPaymentInput {
  /** Integer cents. */
  amount: number
  method: string
  description?: string | null
  treatments?: unknown
  sendNotification?: boolean
  transactionId?: string | null
  externalReference?: string | null
  paymentDate?: Date
}

export interface CheckInInput {
  appointmentId: string
  user: { id: string; roleId?: string | null }
  /** Take a one-time payment as part of the check-in. */
  payment?: CheckInPaymentInput
  /** Check in without taking money; the reason is kept on the visit. */
  noPaymentReason?: string
  /** The payment was recorded separately (plan or insurance) and is already linked to this visit. */
  paymentRecordedElsewhere?: boolean
  /** Required of an admin changing a visit from a previous day. */
  overrideReason?: string
  now?: Date
}

export interface CheckInResult {
  appointment: typeof appointments.$inferSelect
  payment: typeof payments.$inferSelect | null
  /** True when the visit was already checked in: nothing was changed or charged. */
  alreadyCheckedIn: boolean
  /** The reason an admin gave for changing a past visit, when one was needed. */
  pastDayReason: string | null
}

export async function checkInAppointment(db: DB, input: CheckInInput): Promise<CheckInResult> {
  const now = input.now ?? new Date()
  const { appointmentId, user } = input

  return db.transaction(async (rawTx) => {
    // The service helpers take a DB; a transaction is used the same way (their own
    // transactions nest as savepoints).
    const tx = rawTx as unknown as DB

    // Lock the visit. A second request for the same visit waits here, then sees the
    // first one's result instead of racing it.
    const [appt] = await rawTx
      .select()
      .from(appointments)
      .where(eq(appointments.id, appointmentId))
      .for('update')
    if (!appt) {
      throw new CheckInError(404, { error: 'Appointment not found', code: 'APPOINTMENT_NOT_FOUND' })
    }

    // Already here: a retry, a double-click, or a colleague got there first. Answer
    // success and take nothing.
    if (appt.status === 'checked_in' || appt.status === 'in_chair') {
      return { appointment: appt, payment: null, alreadyCheckedIn: true, pastDayReason: null }
    }

    if (TERMINAL_APPOINTMENT_STATUSES.has(appt.status)) {
      throw new CheckInError(409, {
        error: `This appointment is already ${appt.status.replace('_', ' ')} and can't be checked in.`,
        code: 'APPOINTMENT_TERMINAL',
      })
    }
    if (!isPreArrivalStatus(appt.status) || !canChangeStatus(appt.status, 'checked_in')) {
      throw new CheckInError(409, {
        error: `A ${appt.status.replace('_', ' ')} appointment can't be checked in.`,
        code: 'APPOINTMENT_INVALID_TRANSITION',
      })
    }

    // A visit from a previous day is the admin's to change, with a reason (D6).
    const decision = pastDayDecision({
      appointmentDate: new Date(appt.date),
      now,
      isAdmin: user.roleId === 'admin',
      targetStatus: 'checked_in',
      statusOnly: true,
    })
    if (decision === 'locked') {
      throw new CheckInError(403, {
        error: 'Past appointments are read-only',
        code: 'APPOINTMENT_PAST_LOCKED',
      })
    }
    const overrideReason = input.overrideReason?.trim() ?? ''
    if (decision === 'needs_reason' && overrideReason.length < 3) {
      throw new CheckInError(400, {
        error: 'Changing a past appointment requires a reason (3+ chars)',
        code: 'OVERRIDE_REASON_REQUIRED',
      })
    }

    // The money. The patient is the visit's own, never whatever the request names.
    let payment: typeof payments.$inferSelect | null = null
    if (input.payment) {
      try {
        const recorded = await recordLegacyPayment(
          tx,
          {
            patientId: appt.patientId,
            amount: input.payment.amount,
            // Methods are admin-defined lookup slugs, so callers cast at this boundary; the
            // ledger refuses one nobody has set up (D23), which comes back as a 400 below.
            method: input.payment.method as PaymentMethod,
            paymentDate: input.payment.paymentDate,
            description: input.payment.description ?? null,
            appointmentId: appt.id,
            transactionId: input.payment.transactionId ?? null,
            externalReference: input.payment.externalReference ?? null,
            treatments: input.payment.treatments,
            sendNotification: input.payment.sendNotification,
          },
          user.id
        )
        // Check-in takes exactly one payment, so there is exactly one row.
        payment = recorded.payments[0].payment
      } catch (err) {
        // A database fault (deadlock, dropped connection, constraint) is ours, not
        // the cashier's: let it through to the generic 500. Its message carries the
        // SQL and every bound parameter, which must not reach the browser.
        if (err instanceof DrizzleQueryError) throw err
        // A refusal by the ledger (wallet short, visit not payable, bad amount).
        throw new CheckInError(400, {
          error: errMessage(err, 'The payment was rejected'),
          code: 'CHECKIN_PAYMENT_REJECTED',
        })
      }
    }

    const updates: Partial<typeof appointments.$inferInsert> = {
      status: 'checked_in',
      checkedInAt: now,
      updatedAt: now,
    }
    // A requires-estimate visit enters the doctor's estimate queue on check-in.
    if (appt.requiresEstimate && !appt.estimateStatus) updates.estimateStatus = 'awaiting_estimate'
    if (input.noPaymentReason) {
      const stamp = `[checked_in ${now.toISOString()}]: Checked in without payment — ${input.noPaymentReason.trim()}`
      updates.notes = appt.notes ? `${appt.notes}\n${stamp}` : stamp
    }

    const [updated] = await rawTx
      .update(appointments)
      .set(updates)
      .where(eq(appointments.id, appt.id))
      .returning()

    // The doctor's to-do (idempotent: the walk-in flow queues its own too).
    await ensurePendingMedicalRecord(tx, {
      patientId: appt.patientId,
      doctorId: appt.doctorId,
      appointmentId: appt.id,
    })

    return {
      appointment: updated,
      payment,
      alreadyCheckedIn: false,
      pastDayReason: decision === 'needs_reason' ? overrideReason : null,
    }
  })
}
