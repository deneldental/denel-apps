/**
 * Scheduled reminders cron runner.
 *
 * Runs every 15 minutes via setInterval. For each active scheduled_reminder row,
 * determines whether it should fire based on triggerType, sends SMS to the
 * relevant patients, and updates lastRunAt to prevent double-firing.
 *
 * Trigger types:
 *  - before_appointment  Find upcoming appointments within triggerOffsetHours,
 *                        send a personalised SMS to each patient.
 *  - on_date             Fire once when scheduledAt falls in the current 15-min
 *                        window (and lastRunAt is null or predates scheduledAt).
 *  - recurring           Fire if the current time matches the cron hour/minute
 *                        window and lastRunAt is from a previous day.
 */

import { isWithinQuietHours } from '@denel/utils'
import { and, eq, gte, lte, or } from 'drizzle-orm'
import { env } from '../config/env'
import { getDb } from '../db'
import { appointments, appointmentTypeReminders, patients, scheduledReminders } from '../db/schema'
import {
  excludesAppointmentTypeNames,
  matchesAppointmentTypeName,
  resolveAppointmentTypeNames,
} from './appointment-type-matching'
import { getBranding } from './branding'
import { runCredentialExpiryCheck } from './credential-expiry'
import { logger } from './logger'
import { getCrmPolicies } from './settings-store'
import { sendSMS } from './sms'

const TICK_MS = 15 * 60 * 1000 // 15 minutes

// ── Template interpolation ────────────────────────────────────────────────────

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`)
}

// ── Minimal cron matcher (hour + minute only) ─────────────────────────────────
// Supports `M H * * *` where M and H can be a number or `*`.
// Returns true if the current hour:minute is within the 15-min tick window.

function cronShouldFireNow(expr: string, now: Date): boolean {
  const parts = expr.trim().split(/\s+/)
  if (parts.length < 2) return false
  const [minutePart, hourPart] = parts

  const h = now.getHours()
  const m = now.getMinutes()

  const hourMatch = hourPart === '*' || Number(hourPart) === h
  // minute matches if within the 15-min window (0–14, 15–29, 30–44, 45–59)
  const minuteMatch = minutePart === '*' || Number(minutePart) === m

  return hourMatch && minuteMatch
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

// ── Core runner ───────────────────────────────────────────────────────────────

async function runScheduler(): Promise<void> {
  const db = getDb(env.DATABASE_URL)
  const now = new Date()

  let reminders: (typeof scheduledReminders.$inferSelect)[]
  try {
    reminders = await db
      .select()
      .from(scheduledReminders)
      .where(eq(scheduledReminders.isActive, true))
  } catch (err) {
    logger.error({ err }, '[scheduler] Failed to fetch scheduled reminders')
    return
  }

  // Quiet hours (Settings → CRM → Automations) hold every queued send —
  // birthday, follow-up, recare, custom — until the first tick after the
  // window; appointment reminders and credential checks below are not held
  // (settings-domain-audit S5-B).
  let holdQueued = false
  try {
    const policies = await getCrmPolicies(db)
    holdQueued =
      policies.quietHoursEnabled &&
      isWithinQuietHours(now, policies.quietHoursStart, policies.quietHoursEnd)
  } catch (err) {
    logger.error({ err }, '[scheduler] could not read CRM policies — not holding sends')
  }

  if (holdQueued) {
    if (reminders.length > 0)
      logger.info({ held: reminders.length }, '[scheduler] quiet hours — queued sends held')
  } else {
    for (const reminder of reminders) {
      try {
        await processReminder(db, reminder, now)
      } catch (err) {
        logger.error({ err, reminderId: reminder.id }, '[scheduler] Error processing reminder')
      }
    }
  }

  // Independent track — Appointment Type Reminders
  try {
    await processAppointmentTypeReminders(db, now)
  } catch (err) {
    logger.error({ err }, '[scheduler] appointment type reminders check failed')
  }

  // Independent track — credential expiry reminders. Idempotent within a
  // ~20h dedupe window so safe to call on every tick.
  try {
    await runCredentialExpiryCheck(db, now)
  } catch (err) {
    logger.error({ err }, '[scheduler] credential expiry check failed')
  }
}

async function processReminder(
  db: ReturnType<typeof getDb>,
  reminder: typeof scheduledReminders.$inferSelect,
  now: Date
): Promise<void> {
  // §13.2 — marketing sends are queued with requiresConfirmation=true and held
  // here until a staff member confirms them (sets confirmedAt). Transactional
  // reminders leave requiresConfirmation=false and dispatch as before.
  if (reminder.requiresConfirmation && !reminder.confirmedAt) return

  switch (reminder.triggerType) {
    case 'on_date':
      await handleOnDate(db, reminder, now)
      break
    case 'recurring':
      await handleRecurring(db, reminder, now)
      break
    default:
      logger.warn(
        { reminderId: reminder.id, triggerType: reminder.triggerType },
        '[scheduler] Unknown triggerType'
      )
  }
}

// ── before_appointment (Appointment Types) ──────────────────────────────────

async function processAppointmentTypeReminders(
  db: ReturnType<typeof getDb>,
  now: Date
): Promise<void> {
  const policies = await db.query.appointmentTypeReminders.findMany({
    where: and(
      eq(appointmentTypeReminders.triggerType, 'before_appointment'),
      eq(appointmentTypeReminders.isActive, true)
    ),
    with: { template: true },
  })

  if (policies.length === 0) return

  // To avoid duplicate sends within the same 15 minute window, we assume idempotency
  // based on the window. However, this could double-fire if the scheduler is rerun manually within 15 mins.
  // The system relies on the strict 15 minute offset matching.

  // Policies are keyed by `appointment_types.id`, but `appointments.type` stores
  // the type NAME — see appointment-type-matching.ts. Translate once for the
  // whole pass rather than per policy.
  const policyTypeIds = policies
    .map((p) => p.appointmentTypeId)
    .filter((id): id is string => Boolean(id))
  const namesById = await resolveAppointmentTypeNames(db, policyTypeIds)
  const configuredNames = Array.from(namesById.values())

  for (const policy of policies) {
    const offsetHours = policy.offsetHours
    if (!offsetHours || offsetHours <= 0 || !policy.template) continue

    // Window: appointments whose date falls within [now + offset - 15min, now + offset]
    const windowEnd = new Date(now.getTime() + offsetHours * 60 * 60 * 1000)
    const windowStart = new Date(windowEnd.getTime() - TICK_MS)

    // Default policies apply where type is not explicitly configured
    let typeCondition
    if (policy.appointmentTypeId) {
      const typeName = namesById.get(policy.appointmentTypeId)
      // The type was deleted out from under the policy (the FK cascades, so this
      // is belt-and-braces). Matching nothing beats matching everything.
      if (!typeName) continue
      typeCondition = matchesAppointmentTypeName(typeName)
    } else {
      // Find all types that HAVE explicit rules, and exclude them.
      typeCondition = excludesAppointmentTypeNames(configuredNames)
    }

    const conditions: any[] = [
      gte(appointments.date, windowStart),
      lte(appointments.date, windowEnd),
      or(eq(appointments.status, 'scheduled'), eq(appointments.status, 'confirmed')),
    ]
    if (typeCondition) conditions.push(typeCondition)

    const upcoming = await db
      .select({
        appointmentId: appointments.id,
        appointmentDate: appointments.date,
        patientId: patients.id,
        patientName: patients.name,
        patientPhone: patients.phone,
      })
      .from(appointments)
      .innerJoin(patients, eq(appointments.patientId, patients.id))
      .where(and(...conditions))

    if (upcoming.length === 0) continue

    const recipients = upcoming
      .filter((r) => r.patientPhone)
      .map((r) => ({
        phone: r.patientPhone!,
        message: renderTemplate(policy.template!.messageTemplate, {
          patientName: r.patientName,
          appointmentDate: r.appointmentDate.toLocaleDateString('en-GH', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
          }),
          appointmentTime: r.appointmentDate.toLocaleTimeString('en-GH', {
            hour: '2-digit',
            minute: '2-digit',
          }),
        }),
        patientId: r.patientId,
      }))

    if (recipients.length === 0) continue

    const smsResult = await sendSMS(recipients, undefined, 'appointment')
    if (!smsResult.success) {
      logger.error(
        { policyId: policy.id, error: smsResult.error },
        '[scheduler] before_appointment SMS failed'
      )
      continue
    }

    logger.info(
      { policyId: policy.id, sentCount: recipients.length },
      '[scheduler] before_appointment reminder sent'
    )
  }
}

// ── on_date ───────────────────────────────────────────────────────────────────

async function handleOnDate(
  db: ReturnType<typeof getDb>,
  reminder: typeof scheduledReminders.$inferSelect,
  now: Date
): Promise<void> {
  const scheduledAt = reminder.scheduledAt
  if (!scheduledAt) return

  // Already ran after the scheduled time
  if (reminder.lastRunAt && reminder.lastRunAt >= scheduledAt) return

  // scheduledAt must be in the past (or within this tick)
  if (scheduledAt > new Date(now.getTime() + TICK_MS)) return

  // For birthday-type reminders: find patients whose birthday is today
  if (reminder.type === 'birthday') {
    await handleBirthdayReminder(db, reminder, now)
    return
  }

  // Patient-specific reminder — send SMS directly to the linked patient
  if (reminder.patientId) {
    const [patient] = await db
      .select({ id: patients.id, name: patients.name, phone: patients.phone })
      .from(patients)
      .where(eq(patients.id, reminder.patientId))

    let smsSent = false
    if (patient?.phone) {
      const branding = await getBranding().catch(() => null)
      const firstName = patient.name.split(' ')[0] ?? patient.name
      const message = renderTemplate(reminder.messageTemplate, {
        firstName,
        patientName: patient.name,
        date: scheduledAt.toLocaleDateString('en-GH', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        }),
        time: scheduledAt.toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' }),
        clinicName: branding?.name ?? 'Denel Dental',
      })
      const smsResult = await sendSMS(
        [{ phone: patient.phone, message, patientId: patient.id }],
        undefined,
        'bulk'
      )
      if (smsResult.success) {
        smsSent = true
        logger.info(
          { reminderId: reminder.id, patientId: patient.id },
          '[scheduler] patient_specific reminder sent'
        )
      } else {
        logger.error(
          { reminderId: reminder.id, patientId: patient.id, error: smsResult.error },
          '[scheduler] patient_specific SMS failed — status not updated to sent'
        )
      }
    } else {
      logger.warn(
        { reminderId: reminder.id, patientId: reminder.patientId },
        '[scheduler] patient has no phone number'
      )
    }

    await db
      .update(scheduledReminders)
      .set({ lastRunAt: now, status: smsSent ? 'sent' : 'failed' })
      .where(eq(scheduledReminders.id, reminder.id))
    return
  }

  // Generic on_date with no patient: just mark as run
  await db
    .update(scheduledReminders)
    .set({ lastRunAt: now })
    .where(eq(scheduledReminders.id, reminder.id))

  logger.info(
    { reminderId: reminder.id, type: reminder.type },
    '[scheduler] on_date reminder fired'
  )
}

// ── recurring ─────────────────────────────────────────────────────────────────

async function handleRecurring(
  db: ReturnType<typeof getDb>,
  reminder: typeof scheduledReminders.$inferSelect,
  now: Date
): Promise<void> {
  // Don't re-run within the same day unless cron says otherwise
  if (reminder.lastRunAt && isSameDay(reminder.lastRunAt, now)) return

  if (reminder.cronExpression && !cronShouldFireNow(reminder.cronExpression, now)) return

  if (reminder.type === 'birthday') {
    await handleBirthdayReminder(db, reminder, now)
    return
  }

  // Generic recurring: mark run
  await db
    .update(scheduledReminders)
    .set({ lastRunAt: now })
    .where(eq(scheduledReminders.id, reminder.id))

  logger.info(
    { reminderId: reminder.id, type: reminder.type },
    '[scheduler] recurring reminder fired'
  )
}

// ── Birthday helper ───────────────────────────────────────────────────────────

async function handleBirthdayReminder(
  db: ReturnType<typeof getDb>,
  reminder: typeof scheduledReminders.$inferSelect,
  now: Date
): Promise<void> {
  const todayMonth = now.getMonth() + 1
  const todayDay = now.getDate()

  // Fetch patients whose dob month+day matches today
  // Using a raw SQL expression to extract month and day from timestamp
  const { sql } = await import('drizzle-orm')

  const birthdayPatients = await db
    .select({ id: patients.id, name: patients.name, phone: patients.phone })
    .from(patients)
    .where(
      and(
        sql`EXTRACT(MONTH FROM ${patients.dob}) = ${todayMonth}`,
        sql`EXTRACT(DAY FROM ${patients.dob}) = ${todayDay}`
      )
    )

  const recipients = birthdayPatients
    .filter((p) => p.phone)
    .map((p) => ({
      phone: p.phone!,
      message: renderTemplate(reminder.messageTemplate, { patientName: p.name }),
      patientId: p.id,
    }))

  if (recipients.length > 0) {
    const smsResult = await sendSMS(recipients, undefined, 'birthday')
    if (!smsResult.success) {
      logger.error(
        { reminderId: reminder.id, error: smsResult.error },
        '[scheduler] birthday SMS failed — lastRunAt not updated'
      )
      return
    }
  }

  await db
    .update(scheduledReminders)
    .set({ lastRunAt: now })
    .where(eq(scheduledReminders.id, reminder.id))

  logger.info(
    { reminderId: reminder.id, sentCount: recipients.length },
    '[scheduler] birthday reminder sent'
  )
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

export function startScheduler(): void {
  // Run immediately on startup, then every 15 minutes
  runScheduler().catch((err) => logger.error({ err }, '[scheduler] Initial run failed'))

  setInterval(() => {
    runScheduler().catch((err) => logger.error({ err }, '[scheduler] Tick failed'))
  }, TICK_MS)

  logger.info('[scheduler] Started — tick interval: 15 minutes')
}

export { runScheduler }
