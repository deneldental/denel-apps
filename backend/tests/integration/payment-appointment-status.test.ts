/**
 * Regression test for C2 — createDraftPayment must reject a payment created
 * against a cancelled/no_show appointment.
 *
 * The bug: payment-service.ts had zero reference to appointment status
 * anywhere in its checks, so a payment could be created and posted against
 * an appointment that never properly happened. See
 * project-docs/patient-records-and-scheduling-audit.md, finding C2.
 */

import { describe, expect, it } from 'vitest'
import { createDraftPayment } from '../../src/lib/payment-service'
import { anyUserId, makeAppointment, makeDoctor, makePatient } from './_fixtures'
import { expectRejection, noDb, withRollback } from './_setup'

describe.skipIf(noDb)('createDraftPayment — rejects a non-payable appointment [C2]', () => {
  it.each([
    'cancelled',
    'no_show',
  ])('rejects a payment against a %s appointment', async (status) => {
    const err = await expectRejection(
      async (tx) => {
        const patientId = await makePatient(tx)
        const doctorId = await makeDoctor(tx)
        const appointmentId = await makeAppointment(tx, { patientId, doctorId, status })

        await createDraftPayment(
          tx,
          { patientId, amount: 100, method: 'cash', appointmentId },
          await anyUserId(tx)
        )
      },
      new RegExp(status.replace('_', ' '))
    )
    expect(err.message).toMatch(/cannot create a payment/i)
  })

  it('still allows a payment against a completed appointment (the normal flow)', async () => {
    await withRollback(async (tx) => {
      const patientId = await makePatient(tx)
      const doctorId = await makeDoctor(tx)
      const appointmentId = await makeAppointment(tx, {
        patientId,
        doctorId,
        status: 'completed',
      })

      const { payment } = await createDraftPayment(
        tx,
        { patientId, amount: 100, method: 'cash', appointmentId },
        await anyUserId(tx)
      )
      expect(payment.appointmentId).toBe(appointmentId)
    })
  })

  it('still allows a payment against a scheduled appointment', async () => {
    await withRollback(async (tx) => {
      const patientId = await makePatient(tx)
      const doctorId = await makeDoctor(tx)
      const appointmentId = await makeAppointment(tx, {
        patientId,
        doctorId,
        status: 'scheduled',
      })

      const { payment } = await createDraftPayment(
        tx,
        { patientId, amount: 100, method: 'cash', appointmentId },
        await anyUserId(tx)
      )
      expect(payment.appointmentId).toBe(appointmentId)
    })
  })

  it('still allows a payment with no appointmentId at all', async () => {
    await withRollback(async (tx) => {
      const patientId = await makePatient(tx)
      const { payment } = await createDraftPayment(
        tx,
        { patientId, amount: 100, method: 'cash' },
        await anyUserId(tx)
      )
      expect(payment.appointmentId).toBeFalsy()
    })
  })
})
