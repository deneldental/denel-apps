/**
 * The two "quick" appointment reminders on Settings → CRM → Automations
 * (24 h / 2 h before) are real stages in `appointment_type_reminders` — the
 * same table Scheduling → Appointment Reminders manages and the 15-minute
 * scheduler sends from (settings-domain-audit S5-B). They live as
 * global-default rows (appointmentTypeId null) pointing at one keyed
 * reminder template; per-type stages configured in Scheduling take
 * precedence in the scheduler as before.
 *
 * Rows the CRM owns are recognised by their template: a global stage that uses
 * any other template belongs to Scheduling and is never touched.
 */

import type { CrmAutomationPolicies } from '@denel/utils'
import { and, eq, isNull } from 'drizzle-orm'
import type { DB } from '../db'
import { appointmentTypeReminders, reminderTemplates } from '../db/schema'

export const CRM_REMINDER_TEMPLATE_KEY = 'crm:appointment_reminder'
const CRM_REMINDER_TEMPLATE_NAME = 'CRM automation — appointment reminder'
const STAGES: ReadonlyArray<{
  offsetHours: number
  enabled: (p: CrmAutomationPolicies) => boolean
}> = [
  { offsetHours: 24, enabled: (p) => p.reminder24h },
  { offsetHours: 2, enabled: (p) => p.reminder2h },
]

export type StageOutcome =
  | 'created'
  | 'reactivated'
  | 'kept'
  | 'deactivated'
  | 'absent'
  | 'managed_elsewhere'

async function ensureTemplate(db: DB, messageTemplate: string, userId: string): Promise<string> {
  const [existing] = await db
    .select({ id: reminderTemplates.id })
    .from(reminderTemplates)
    .where(eq(reminderTemplates.key, CRM_REMINDER_TEMPLATE_KEY))
    .limit(1)
  if (existing) {
    await db
      .update(reminderTemplates)
      .set({ messageTemplate, isActive: true, updatedAt: new Date() })
      .where(eq(reminderTemplates.id, existing.id))
    return existing.id
  }
  const [created] = await db
    .insert(reminderTemplates)
    .values({
      name: CRM_REMINDER_TEMPLATE_NAME,
      key: CRM_REMINDER_TEMPLATE_KEY,
      messageTemplate,
      isActive: true,
      adminOnly: false,
      createdById: userId,
    })
    .returning({ id: reminderTemplates.id })
  return created.id
}

export async function syncCrmReminderStages(
  db: DB,
  policies: CrmAutomationPolicies,
  userId: string
): Promise<{ templateId: string; stages: Record<number, StageOutcome> }> {
  const templateId = await ensureTemplate(db, policies.reminderTemplate, userId)
  const stages: Record<number, StageOutcome> = {}

  for (const stage of STAGES) {
    const rows = await db
      .select()
      .from(appointmentTypeReminders)
      .where(
        and(
          isNull(appointmentTypeReminders.appointmentTypeId),
          eq(appointmentTypeReminders.triggerType, 'before_appointment'),
          eq(appointmentTypeReminders.offsetHours, stage.offsetHours)
        )
      )
    const own = rows.filter((r) => r.templateId === templateId)
    const foreign = rows.filter((r) => r.templateId !== templateId)
    const wanted = stage.enabled(policies)

    if (wanted) {
      if (own.length > 0) {
        const inactive = own.filter((r) => !r.isActive)
        if (inactive.length > 0) {
          for (const r of inactive) {
            await db
              .update(appointmentTypeReminders)
              .set({ isActive: true })
              .where(eq(appointmentTypeReminders.id, r.id))
          }
          stages[stage.offsetHours] = 'reactivated'
        } else {
          stages[stage.offsetHours] = 'kept'
        }
      } else if (foreign.some((r) => r.isActive)) {
        // Scheduling already sends a global reminder at this offset.
        stages[stage.offsetHours] = 'managed_elsewhere'
      } else {
        await db.insert(appointmentTypeReminders).values({
          appointmentTypeId: null,
          triggerType: 'before_appointment',
          offsetHours: stage.offsetHours,
          templateId,
          isActive: true,
        })
        stages[stage.offsetHours] = 'created'
      }
    } else if (own.some((r) => r.isActive)) {
      for (const r of own) {
        await db
          .update(appointmentTypeReminders)
          .set({ isActive: false })
          .where(eq(appointmentTypeReminders.id, r.id))
      }
      stages[stage.offsetHours] = 'deactivated'
    } else {
      stages[stage.offsetHours] = 'absent'
    }
  }

  return { templateId, stages }
}
