import { and, asc, eq } from 'drizzle-orm'
import { paymentPlans, payments } from '../db/schema'

/**
 * Chronologically recalculates all payment balances for a specific payment plan.
 * This ensures that backdated entries properly update the running balance of all subsequent records.
 */
export async function recalculatePlanBalances(db: any, planId: string) {
  // 1. Fetch the payment plan to get the total amount
  const plan = await db.query.paymentPlans.findFirst({
    where: eq(paymentPlans.id, planId),
  })

  if (!plan) return

  // 2. Fetch all posted payments for this plan, ordered chronologically.
  // Payments carry status draft|posted|reversed (payments_status_check) —
  // 'completed' is a legacy value migration 0036 rewrote to 'posted' and no
  // longer occurs, so filtering on it here silently matched zero rows.
  const planPayments = await db.query.payments.findMany({
    where: and(eq(payments.paymentPlanId, planId), eq(payments.status, 'posted')),
    orderBy: [asc(payments.createdAt)],
  })

  let currentBalance = plan.totalAmount

  // 3. Update each payment's balance field based on the running total
  for (const payment of planPayments) {
    currentBalance -= payment.amount

    // Update the payment record with the new balance
    await db
      .update(payments)
      .set({
        balance: Math.max(0, currentBalance),
        updatedAt: new Date(), // Note: schema doesn't have updatedAt for payments, but check schema.ts
      })
      .where(eq(payments.id, payment.id))
  }

  // 4. Update the plan status based on the final balance
  const finalBalance = Math.max(0, currentBalance)
  const newStatus = finalBalance <= 0 ? 'completed' : 'activated' // Or potentially check for 'overdue' if logic exists elsewhere

  await db
    .update(paymentPlans)
    .set({
      status: newStatus,
      updatedAt: new Date(),
    })
    .where(eq(paymentPlans.id, planId))

  return { planId, finalBalance, paymentCount: planPayments.length }
}
