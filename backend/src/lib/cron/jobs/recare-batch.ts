/**
 * Nightly recare/recall batch.
 *
 * Scans `recare_plans` for active, pending plans whose `nextAlertDate` falls
 * in the next 3 days and creates a `scheduled_reminders` row per plan. The
 * existing 15-minute `scheduler-tick` then dispatches the SMS at the right
 * time. Idempotent: we skip plans that already have a pending
 * scheduled_reminders row covering the same alert date.
 *
 * Why this layering: the recare plan owns the *when* + *template* and may
 * recur; the scheduled_reminders row is one concrete SMS to send. Mixing
 * those concerns into a single table makes recurrence + cancellation a mess.
 */

import { and, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm'
import { env } from '../../../config/env'
import { getDb } from '../../../db'
import { recarePlans } from '../../../db/schema/clinical'
import { reminderTemplates, scheduledReminders } from '../../../db/schema/comms'
import { patients } from '../../../db/schema/patients'
import type { JobContext, JobRunResult } from '../types'

export async function runRecareBatch(_ctx: JobContext): Promise<JobRunResult> {
  const db = getDb(env.DATABASE_URL)
  const now = new Date()
  const horizon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)

  // 1. Eligible plans: active, status='pending', nextAlertDate in [now, +3d].
  const plans = await db
    .select({
      id: recarePlans.id,
      patientId: recarePlans.patientId,
      nextAlertDate: recarePlans.nextAlertDate,
      templateId: recarePlans.templateId,
      customMessage: recarePlans.customMessage,
    })
    .from(recarePlans)
    .where(
      and(
        eq(recarePlans.isActive, true),
        eq(recarePlans.status, 'pending'),
        gte(recarePlans.nextAlertDate, now),
        lte(recarePlans.nextAlertDate, horizon)
      )
    )

  if (plans.length === 0) {
    return { summary: 'no recare plans due in the next 3 days' }
  }

  // 2. Idempotency check: any existing pending scheduled_reminders for the
  //    same (patient, day) we're about to schedule? Build a lookup.
  const patientIds = Array.from(new Set(plans.map((p) => p.patientId)))
  const existing = await db
    .select({
      patientId: scheduledReminders.patientId,
      scheduledAt: scheduledReminders.scheduledAt,
    })
    .from(scheduledReminders)
    .where(
      and(
        inArray(scheduledReminders.patientId, patientIds),
        eq(scheduledReminders.type, 'patient_specific'),
        eq(scheduledReminders.status, 'pending'),
        isNotNull(scheduledReminders.scheduledAt)
      )
    )
  const existingKeys = new Set<string>()
  for (const e of existing) {
    if (!e.patientId || !e.scheduledAt) continue
    existingKeys.add(`${e.patientId}::${e.scheduledAt.toISOString().slice(0, 10)}`)
  }

  // 3. Fetch templates we'll need + patient names for the reminder `name`.
  const templateIds = plans.map((p) => p.templateId).filter((id): id is string => !!id)
  const templates = templateIds.length
    ? await db
        .select({
          id: reminderTemplates.id,
          name: reminderTemplates.name,
          messageTemplate: reminderTemplates.messageTemplate,
        })
        .from(reminderTemplates)
        .where(inArray(reminderTemplates.id, templateIds))
    : []
  const templateById = new Map(templates.map((t) => [t.id, t]))

  const ps = await db
    .select({ id: patients.id, name: patients.name })
    .from(patients)
    .where(inArray(patients.id, patientIds))
  const patientNameById = new Map(ps.map((p) => [p.id, p.name]))

  // 4. Build inserts.
  const toInsert: Array<typeof scheduledReminders.$inferInsert> = []
  let skipped = 0
  for (const p of plans) {
    const key = `${p.patientId}::${p.nextAlertDate.toISOString().slice(0, 10)}`
    if (existingKeys.has(key)) {
      skipped++
      continue
    }
    const tpl = p.templateId ? templateById.get(p.templateId) : null
    const message = p.customMessage ?? tpl?.messageTemplate ?? 'This is a recall reminder.'
    const patientName = patientNameById.get(p.patientId) ?? 'Patient'
    toInsert.push({
      name: `Recare — ${patientName}`,
      type: 'patient_specific',
      triggerType: 'on_date',
      scheduledAt: p.nextAlertDate,
      messageTemplate: message,
      isActive: true,
      status: 'pending',
      patientId: p.patientId,
      templateId: p.templateId ?? null,
      createdById: null,
    })
  }

  if (toInsert.length > 0) {
    await db.insert(scheduledReminders).values(toInsert)
  }

  // 5. Flip the plan status so we don't keep re-scheduling the same alert.
  const insertedPlanIds = plans
    .filter(
      (p) => !existingKeys.has(`${p.patientId}::${p.nextAlertDate.toISOString().slice(0, 10)}`)
    )
    .map((p) => p.id)
  if (insertedPlanIds.length > 0) {
    await db
      .update(recarePlans)
      .set({ status: 'alerted', lastAlertDate: now, updatedAt: now })
      .where(and(inArray(recarePlans.id, insertedPlanIds), eq(recarePlans.status, 'pending')))
  }

  return {
    summary: `queued ${toInsert.length} recare SMS · skipped ${skipped} dup · plans scanned ${plans.length}`,
    details: { queued: toInsert.length, skippedDuplicates: skipped, plansScanned: plans.length },
  }
}

// Suppress an unused import warning for `sql` — kept as a hook for future
// per-bucket SQL refinements without churning imports.
void sql
