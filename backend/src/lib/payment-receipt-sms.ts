/**
 * The "thank you for your payment" text sent to a patient after a payment is
 * recorded. Shared by `POST /api/payments` and the check-in payment, so both word
 * it and fail the same way.
 *
 * It NEVER throws. The payment is already committed by the time this runs; a
 * failed text must not be reported as a failed payment, because the cashier who
 * is told "failed" charges the patient again (F31). Callers get `{ error }`
 * back and surface it next to a success, as the portal's "Payment recorded, but
 * SMS failed" message expects.
 */
import type { DB } from '../db'
import { logError } from './logger'
import { sendSMS } from './sms'
import { resolveSmsTemplate } from './sms-templates'

export interface PaymentReceiptSmsInput {
  patient: {
    id: string
    name: string
    phone: string | null
    isChild: boolean | null
    guardianPhone: string | null
  }
  /** Integer cents, as stored. */
  amount: number | string
  /** Outstanding balance after this payment, in cents, when it is known. */
  balance: number | null
  /** The payment description; the text before " - " names the treatments. */
  description?: string | null
  /** A plan payment uses the "with balance" wording. */
  paymentPlanId?: string | null
  userId: string
}

export interface PaymentReceiptSmsResult {
  sent: boolean
  /** Why it was not sent or failed; absent on success and when there was nobody to text. */
  error?: string
}

export async function sendPaymentReceiptSms(
  db: DB,
  input: PaymentReceiptSmsInput
): Promise<PaymentReceiptSmsResult> {
  const { patient } = input
  const contactPhone =
    patient.isChild && patient.guardianPhone ? patient.guardianPhone : patient.phone
  if (!contactPhone) return { sent: false }

  try {
    // Both are integer CENTS; the SMS shows cedis.
    const amountGHS = (Number(input.amount) / 100).toFixed(2)
    const balanceGHS = input.balance !== null ? (Number(input.balance) / 100).toFixed(2) : '0.00'
    const treatmentTypes = (input.description || '').split(' - ')[0] || 'Service Payment'

    let message: string
    if (input.paymentPlanId) {
      const template = await resolveSmsTemplate(
        db,
        'payment:with_balance',
        process.env.PAYMENT_PLAN_SMS ||
          'Dear {Patientname}, thank you for your payment of GHS {amount} for {treatmenttypes}. Your current balance is GHS {balance}. Thank you!'
      )
      message = template
        .replace(/{Patientname}/g, patient.name)
        .replace(/{amount}/g, amountGHS)
        .replace(/{treatmenttypes}/g, treatmentTypes)
        .replace(/{balance}/g, balanceGHS)
    } else {
      const template = await resolveSmsTemplate(
        db,
        'payment:confirmation',
        process.env.PAYMENT_SMS ||
          'Dear {Patientname}, thank you for your payment of GHS {amount} for {treatmenttypes}. Thank you!'
      )
      message = template
        .replace(/{Patientname}/g, patient.name)
        .replace(/{amount}/g, amountGHS)
        .replace(/{treatmenttypes}/g, treatmentTypes)
    }

    const result = await sendSMS(
      [{ phone: contactPhone, message, patientId: patient.id }],
      undefined,
      'bulk',
      input.userId
    )
    return result.success
      ? { sent: true }
      : { sent: false, error: result.error ?? 'SMS provider rejected the message' }
  } catch (err) {
    logError(err, { context: 'payment receipt SMS (non-fatal)', patientId: patient.id })
    return { sent: false, error: err instanceof Error ? err.message : 'SMS failed' }
  }
}
