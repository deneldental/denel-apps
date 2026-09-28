/**
 * Daily payment-plan overdue detection.
 *
 * Walks payment_plan_schedule_items where status='pending' and expectedDate
 * is in the past, marks them 'overdue', and (for each newly overdue item)
 * inserts a `patient_reminders` row so the receptionist sees the action in
 * Activities. Items already marked 'overdue' are not re-flagged.
 */

import { and, eq, lt, sql } from 'drizzle-orm'
import { env } from '../../../config/env'
import { getDb } from '../../../db'
import { paymentPlans } from '../../../db/schema/billing'
import { patientReminders } from '../../../db/schema/clinical'
import { paymentPlanScheduleItems } from '../../../db/schema/payment-plan-schedule-items'
import type { JobContext, JobRunResult } from '../types'

export async function runPaymentPlanOverdue(_ctx: JobContext): Promise<JobRunResult> {
  const db = getDb(env.DATABASE_URL)
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD; schedule items use `date` column

  // Pull pending items with expectedDate before today + their plan's patient.
  const rows = await db
    .select({
      id: paymentPlanScheduleItems.id,
      planId: paymentPlanScheduleItems.paymentPlanId,
      sequence: paymentPlanScheduleItems.sequence,
      expectedDate: paymentPlanScheduleItems.expectedDate,
      expectedAmount: paymentPlanScheduleItems.expectedAmount,
      patientId: paymentPlans.patientId,
    })
    .from(paymentPlanScheduleItems)
    .innerJoin(paymentPlans, eq(paymentPlanScheduleItems.paymentPlanId, paymentPlans.id))
    .where(
      and(
        eq(paymentPlanScheduleItems.status, 'pending'),
        lt(paymentPlanScheduleItems.expectedDate, sql`${today}::date`)
      )
    )
    .limit(5000)

  if (rows.length === 0) {
    return { summary: 'no overdue items' }
  }

  // Flip status to overdue in bulk.
  const ids = rows.map((r) => r.id)
  await db
    .update(paymentPlanScheduleItems)
    .set({ status: 'overdue' })
    .where(
      and(
        eq(paymentPlanScheduleItems.status, 'pending'),
        sql`${paymentPlanScheduleItems.id} = ANY(${ids})`
      )
    )

  // One reminder per overdue item — receptionist closes it after acting.
  const remindersToInsert = rows
    .filter((r) => r.patientId)
    .map((r) => ({
      patientId: r.patientId,
      title: `Payment plan installment #${r.sequence} overdue (GHS ${(Number(r.expectedAmount) / 100).toFixed(2)})`,
      notes: `Plan ${r.planId} · expected ${r.expectedDate}`,
      reminderDate: new Date(),
      status: 'pending' as const,
      createdById: null,
    }))

  if (remindersToInsert.length > 0) {
    await db.insert(patientReminders).values(remindersToInsert)
  }

  return {
    summary: `flagged ${rows.length} overdue items, queued ${remindersToInsert.length} reminders`,
    details: { flagged: rows.length, reminders: remindersToInsert.length },
  }
}
