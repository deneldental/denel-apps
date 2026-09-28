/**
 * CRM auto-queue — admin-v1 §13.2.
 *
 * Populates the `scheduled_reminders` queue from the live CRM segments so staff
 * don't have to hand-schedule routine outreach. Two segments are queued here:
 *   - birthdays  — patients whose birthday is today
 *   - follow-ups — patients whose appointment completed 48–72h ago
 * (recare is already queued by the nightly `recare-batch` job.)
 *
 * These are marketing-type sends, so each row is queued with
 * `requiresConfirmation = true`: it sits in the queue until a staff member
 * confirms it (the scheduler holds unconfirmed rows — see `scheduler.ts`).
 * Opted-out patients (`doNotContact`) are excluded (§13.3), and the populator is
 * idempotent per (patient, kind, day) so re-running a day doesn't double-queue.
 */

import { atClockTime, type CrmAutomationPolicies } from '@denel/utils'
import { and, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm'
import type { DB } from '../db'
import { appointments } from '../db/schema/clinical'
import { scheduledReminders } from '../db/schema/comms'
import { patients } from '../db/schema/patients'
import { logger } from './logger'
import { getCrmPolicies } from './settings-store'

export type AutoQueueKind = 'birthday' | 'followup'

export interface AutoQueueCandidate {
  patientId: string
  patientName: string
  phone: string
  kind: AutoQueueKind
}

const KIND_LABEL: Record<AutoQueueKind, string> = {
  birthday: 'Birthday',
  followup: 'Follow-up',
}

const KIND_MESSAGE: Record<AutoQueueKind, string> = {
  birthday: 'Happy Birthday {firstName}! Warm wishes from all of us at {clinicName}.',
  followup:
    'Hi {firstName}, thank you for visiting {clinicName}. How are you feeling after your recent treatment? Reply if you have any concerns.',
}

/** The display name a queued row gets — also the (patient, kind) dedupe anchor. */
function rowName(c: AutoQueueCandidate): string {
  return `${KIND_LABEL[c.kind]} — ${c.patientName}`
}

/**
 * The birthday + follow-up patients eligible for an auto-queued send as of
 * `now`, opted-out patients excluded. Pure read — queues nothing.
 */
export async function selectCrmAutoQueueCandidates(
  db: DB,
  now: Date = new Date()
): Promise<AutoQueueCandidate[]> {
  const month = now.getMonth() + 1
  const day = now.getDate()

  // Birthdays today.
  const bdayRows = await db
    .select({ id: patients.id, name: patients.name, phone: patients.phone })
    .from(patients)
    .where(
      and(
        sql`EXTRACT(MONTH FROM ${patients.dob}) = ${month}`,
        sql`EXTRACT(DAY FROM ${patients.dob}) = ${day}`,
        eq(patients.doNotContact, false)
      )
    )

  // Follow-ups: appointment completed 48–72h ago.
  const ago48h = new Date(now.getTime() - 48 * 60 * 60 * 1000)
  const ago72h = new Date(now.getTime() - 72 * 60 * 60 * 1000)
  const fuRows = await db
    .select({ id: patients.id, name: patients.name, phone: patients.phone })
    .from(appointments)
    .innerJoin(patients, eq(appointments.patientId, patients.id))
    .where(
      and(
        eq(appointments.status, 'completed'),
        gte(appointments.completedAt, ago72h),
        lte(appointments.completedAt, ago48h),
        eq(patients.doNotContact, false)
      )
    )

  const out: AutoQueueCandidate[] = []
  const seen = new Set<string>()
  const push = (id: string, name: string, phone: string | null, kind: AutoQueueKind) => {
    const p = (phone ?? '').trim()
    if (!p) return // no phone → nothing to send
    const key = `${id}::${kind}`
    if (seen.has(key)) return // a patient with two completed appts → one follow-up
    seen.add(key)
    out.push({ patientId: id, patientName: name, phone: p, kind })
  }
  for (const r of bdayRows) push(r.id, r.name, r.phone, 'birthday')
  for (const r of fuRows) push(r.id, r.name, r.phone, 'followup')
  return out
}

/**
 * Queue the day's birthday + follow-up sends as `scheduled_reminders` rows
 * (requiresConfirmation=true, pending). Idempotent per (patient, kind, day):
 * skips any candidate that already has a same-kind row scheduled today.
 */
export async function runCrmAutoQueue(
  db: DB,
  now: Date = new Date(),
  policiesOverride?: CrmAutomationPolicies
): Promise<{ queued: number; skipped: number; scanned: number }> {
  // Settings → CRM → Automations decides whether birthdays are queued at all,
  // with which message and for what time of day (settings-domain-audit S5-B).
  const policies = policiesOverride ?? (await getCrmPolicies(db))
  const candidates = (await selectCrmAutoQueueCandidates(db, now)).filter(
    (c) => c.kind !== 'birthday' || policies.birthdayGreetings
  )
  if (candidates.length === 0) return { queued: 0, skipped: 0, scanned: 0 }
  const birthdayAt = atClockTime(now, policies.birthdaySendTime)

  const dayStart = new Date(now)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(now)
  dayEnd.setHours(23, 59, 59, 999)

  // Existing same-day patient_specific rows → dedupe keys `${patientId}::${kind}`.
  const patientIds = Array.from(new Set(candidates.map((c) => c.patientId)))
  const existing = await db
    .select({ patientId: scheduledReminders.patientId, name: scheduledReminders.name })
    .from(scheduledReminders)
    .where(
      and(
        inArray(scheduledReminders.patientId, patientIds),
        eq(scheduledReminders.type, 'patient_specific'),
        gte(scheduledReminders.scheduledAt, dayStart),
        lte(scheduledReminders.scheduledAt, dayEnd),
        ne(scheduledReminders.status, 'cancelled')
      )
    )
  const existingKeys = new Set<string>()
  for (const e of existing) {
    if (!e.patientId) continue
    const kind: AutoQueueKind | null = e.name.startsWith(KIND_LABEL.birthday)
      ? 'birthday'
      : e.name.startsWith(KIND_LABEL.followup)
        ? 'followup'
        : null
    if (kind) existingKeys.add(`${e.patientId}::${kind}`)
  }

  const toInsert = candidates.filter((c) => !existingKeys.has(`${c.patientId}::${c.kind}`))
  if (toInsert.length > 0) {
    await db.insert(scheduledReminders).values(
      toInsert.map((c) => ({
        name: rowName(c),
        type: 'patient_specific',
        triggerType: 'on_date' as const,
        scheduledAt: c.kind === 'birthday' ? birthdayAt : now,
        messageTemplate: c.kind === 'birthday' ? policies.birthdayTemplate : KIND_MESSAGE[c.kind],
        isActive: true,
        status: 'pending' as const,
        requiresConfirmation: true,
        patientId: c.patientId,
        createdById: null,
      }))
    )
  }

  const skipped = candidates.length - toInsert.length
  if (toInsert.length > 0) {
    logger.info(
      { queued: toInsert.length, skipped, scanned: candidates.length },
      '[crm-autoqueue] tick complete'
    )
  }
  return { queued: toInsert.length, skipped, scanned: candidates.length }
}
