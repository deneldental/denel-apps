/**
 * settings-domain-audit S5-B (CRM) against a real Postgres:
 *   - `syncCrmReminderStages` keeps two global-default appointment reminder
 *     stages (24 h / 2 h before) in step with the toggles and template,
 *     without touching stages Scheduling manages;
 *   - `runCrmAutoQueue` honours the birthday toggle, template and send time.
 * Everything runs inside withRollback.
 */

import { DEFAULT_CRM_POLICIES } from '@denel/utils'
import { and, eq, isNull } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { DB } from '../../src/db'
import {
  appointmentTypeReminders,
  patients,
  reminderTemplates,
  scheduledReminders,
} from '../../src/db/schema'
import { runCrmAutoQueue } from '../../src/lib/crm-autoqueue'
import { CRM_REMINDER_TEMPLATE_KEY, syncCrmReminderStages } from '../../src/lib/crm-reminder-stages'
import { anyUserId, makePatient } from './_fixtures'
import { noDb, withRollback } from './_setup'

async function globalStages(tx: DB) {
  return tx
    .select()
    .from(appointmentTypeReminders)
    .where(
      and(
        isNull(appointmentTypeReminders.appointmentTypeId),
        eq(appointmentTypeReminders.triggerType, 'before_appointment')
      )
    )
}

async function crmTemplate(tx: DB) {
  const [row] = await tx
    .select()
    .from(reminderTemplates)
    .where(eq(reminderTemplates.key, CRM_REMINDER_TEMPLATE_KEY))
    .limit(1)
  return row
}

describe.skipIf(noDb)('CRM automation policies (S5-B)', () => {
  it('creates, keeps, updates and deactivates the two global stages', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const before = (await globalStages(tx)).length

      await syncCrmReminderStages(
        tx,
        {
          ...DEFAULT_CRM_POLICIES,
          reminder24h: true,
          reminder2h: true,
          reminderTemplate: 'v1 {patientName}',
        },
        userId
      )
      const tpl = await crmTemplate(tx)
      expect(tpl?.messageTemplate).toBe('v1 {patientName}')
      let stages = (await globalStages(tx)).filter((s) => s.templateId === tpl?.id)
      expect(stages.map((s) => s.offsetHours).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([2, 24])
      expect(stages.every((s) => s.isActive)).toBe(true)

      // Same policies again → no duplicates, template text updated.
      await syncCrmReminderStages(
        tx,
        { ...DEFAULT_CRM_POLICIES, reminder24h: true, reminder2h: true, reminderTemplate: 'v2' },
        userId
      )
      expect((await globalStages(tx)).length).toBe(before + 2)
      expect((await crmTemplate(tx))?.messageTemplate).toBe('v2')

      // 2 h off → that stage is deactivated, 24 h stays.
      await syncCrmReminderStages(
        tx,
        { ...DEFAULT_CRM_POLICIES, reminder24h: true, reminder2h: false },
        userId
      )
      stages = (await globalStages(tx)).filter((s) => s.templateId === tpl?.id)
      expect(stages.find((s) => s.offsetHours === 2)?.isActive).toBe(false)
      expect(stages.find((s) => s.offsetHours === 24)?.isActive).toBe(true)

      // Back on → reactivated, still no duplicate.
      await syncCrmReminderStages(
        tx,
        { ...DEFAULT_CRM_POLICIES, reminder24h: true, reminder2h: true },
        userId
      )
      stages = (await globalStages(tx)).filter((s) => s.templateId === tpl?.id)
      expect(stages.length).toBe(2)
      expect(stages.every((s) => s.isActive)).toBe(true)
    })
  })

  it('never touches a global stage that Scheduling manages with its own template', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const [ownTpl] = await tx
        .insert(reminderTemplates)
        .values({ name: 'IT scheduling template', messageTemplate: 'mine', isActive: true })
        .returning({ id: reminderTemplates.id })
      await tx.insert(appointmentTypeReminders).values({
        appointmentTypeId: null,
        triggerType: 'before_appointment',
        offsetHours: 24,
        templateId: ownTpl.id,
        isActive: true,
      })

      await syncCrmReminderStages(
        tx,
        { ...DEFAULT_CRM_POLICIES, reminder24h: true, reminder2h: false },
        userId
      )
      const rows24 = (await globalStages(tx)).filter((s) => s.offsetHours === 24)
      expect(rows24.length).toBe(1)
      expect(rows24[0].templateId).toBe(ownTpl.id)
      expect(rows24[0].isActive).toBe(true)

      await syncCrmReminderStages(
        tx,
        { ...DEFAULT_CRM_POLICIES, reminder24h: false, reminder2h: false },
        userId
      )
      expect((await globalStages(tx)).filter((s) => s.offsetHours === 24)[0].isActive).toBe(true)
    })
  })

  it('auto-queue: birthday toggle, template and send time', async () => {
    await withRollback(async (tx) => {
      const now = new Date()
      const dob = new Date(1990, now.getMonth(), now.getDate(), 12, 0, 0)
      // The shared fixture fills every required patient column; only the
      // birthday-relevant fields are set here.
      const patientId = await makePatient(tx, 'IT Birthday Person')
      await tx
        .update(patients)
        .set({ dob, phone: '233200000001', doNotContact: false })
        .where(eq(patients.id, patientId))
      const p = { id: patientId }

      const off = await runCrmAutoQueue(tx, now, {
        ...DEFAULT_CRM_POLICIES,
        birthdayGreetings: false,
      })
      const rowsOff = await tx
        .select()
        .from(scheduledReminders)
        .where(eq(scheduledReminders.patientId, p.id))
      expect(rowsOff.filter((r) => r.name.startsWith('Birthday')).length).toBe(0)
      expect(off.scanned).toBe(0)

      await runCrmAutoQueue(tx, now, {
        ...DEFAULT_CRM_POLICIES,
        birthdayGreetings: true,
        birthdaySendTime: '09:45',
        birthdayTemplate: 'HBD {firstName}',
      })
      const rows = (
        await tx.select().from(scheduledReminders).where(eq(scheduledReminders.patientId, p.id))
      ).filter((r) => r.name.startsWith('Birthday'))
      expect(rows.length).toBe(1)
      expect(rows[0].messageTemplate).toBe('HBD {firstName}')
      expect(rows[0].requiresConfirmation).toBe(true)
      expect(rows[0].scheduledAt?.getHours()).toBe(9)
      expect(rows[0].scheduledAt?.getMinutes()).toBe(45)
    })
  })
})
