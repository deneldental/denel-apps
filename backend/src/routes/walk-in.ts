/**
 * walk-in.ts — POST /api/walk-in
 *
 * One transactional endpoint for a front-desk walk-in: create the encounter,
 * bill the chosen catalog services, and take payment. All the orchestration
 * lives in `createWalkIn`; this route only authenticates, validates, and maps
 * a thrown service error to a 400.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'
import { createWalkIn } from '../lib/walk-in-service'

const moneyLike = z.union([z.string(), z.number()])

// v1 accepts the self-pay methods only; insurance stays on the reconciliation
// flow (it credits the patient wallet, it doesn't settle an invoice inline).
const paymentMethod = z.enum([
  'cash',
  'card',
  'momo',
  'transfer',
  'bank_transfer',
  'cheque',
  'wallet',
])

const walkInSchema = z.object({
  patientId: z.string().uuid(),
  appointment: z.object({
    doctorId: z.string().uuid(),
    chairId: z.string().uuid().nullish(),
    type: z.string().nullish(),
    notes: z.string().nullish(),
  }),
  lines: z
    .array(
      z.object({
        serviceId: z.string().uuid(),
        quantity: z.coerce.number().positive().optional(),
        variantName: z.string().nullish(),
        toothClassId: z.string().uuid().nullish(),
        specialistId: z.string().uuid().nullish(),
        discount: z
          .object({
            type: z.enum(['percent', 'amount']),
            value: z.coerce.number().nonnegative(),
            reason: z.string().nullish(),
          })
          .nullish(),
      })
    )
    .min(1),
  payment: z
    .object({
      method: paymentMethod,
      amount: moneyLike,
      externalReference: z.string().nullish(),
    })
    .nullish(),
})

const walkInApp = new Hono<HonoEnv>()

// POST /api/walk-in — record a walk-in encounter (appointment + invoice + payment)
walkInApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  // A walk-in creates both an appointment and an invoice/payment.
  const canBill = await checkPermission(
    c,
    user.id,
    MODULES.PAYMENTS as string,
    ACTIONS.CREATE as string
  )
  const canSchedule = await checkPermission(
    c,
    user.id,
    MODULES.APPOINTMENTS as string,
    ACTIONS.CREATE as string
  )
  if (!canBill || !canSchedule) return c.json({ error: 'Unauthorized' }, 403)

  const parsed = walkInSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const result = await createWalkIn(db, parsed.data, user.id)
    return c.json({ success: true, data: result })
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : 'Failed to record walk-in'
    return c.json({ error: message }, 400)
  }
})

export { walkInApp }
