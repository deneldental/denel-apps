import { and, asc, count, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import {
  breakfastAcknowledgements,
  breakfastSubmissionItems,
  breakfastSubmissions,
  clinicSettings,
  items,
  staff,
} from '../db/schema'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const breakfastApp = new Hono<HonoEnv>()
const BREAKFAST_NOTIFY_KEY = 'hr.breakfast_notifications_enabled'
const MODULE = MODULES.INVENTORY

// Breakfast tracking is reachable from two surfaces: the portal Inventory module
// (INVENTORY perm) and the HR app (which owns breakfast-lead assignment but has
// no INVENTORY perm). Accept either module's permission so an hr_admin can see
// outcomes + toggle notifications without granting them the full Inventory module.
async function canAccessBreakfast(
  c: Parameters<typeof getCurrentUser>[0],
  userId: string,
  action: string
) {
  return (
    (await checkPermission(c, userId, MODULE as string, action)) ||
    (await checkPermission(c, userId, MODULES.STAFF as string, action))
  )
}

// GET /api/breakfast — admin tracking: breakfast inventory levels + recent
// weekly submissions with receipt counts + the notifications toggle state.
breakfastApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await canAccessBreakfast(c, user.id, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)
  const db = getDb(process.env.DATABASE_URL!)

  const inventory = await db
    .select({
      id: items.id,
      name: items.name,
      unit: items.unit,
      stockQuantity: items.stockQuantity,
      reorderLevel: items.reorderLevel,
    })
    .from(items)
    .where(eq(items.category, 'breakfast'))
    .orderBy(asc(items.name))

  const subs = await db
    .select()
    .from(breakfastSubmissions)
    .orderBy(desc(breakfastSubmissions.weekStart))
    .limit(12)
  const [{ value: totalStaff }] = await db
    .select({ value: count() })
    .from(staff)
    .where(and(eq(staff.status, 'active'), eq(staff.isExternalTrainer, false)))

  const submissions = []
  for (const s of subs) {
    const [its, acks, lead] = await Promise.all([
      db
        .select()
        .from(breakfastSubmissionItems)
        .where(eq(breakfastSubmissionItems.submissionId, s.id)),
      db
        .select({ value: count() })
        .from(breakfastAcknowledgements)
        .where(eq(breakfastAcknowledgements.submissionId, s.id)),
      s.submittedByStaffId
        ? db
            .select({ fullName: staff.fullName })
            .from(staff)
            .where(eq(staff.id, s.submittedByStaffId))
            .limit(1)
        : Promise.resolve([] as { fullName: string }[]),
    ])
    submissions.push({
      id: s.id,
      weekStart: s.weekStart,
      note: s.note,
      createdAt: s.createdAt,
      submittedBy: lead[0]?.fullName ?? null,
      items: its.map((i) => ({ itemName: i.itemName, quantity: i.quantity })),
      ackCount: Number(acks[0]?.value ?? 0),
      totalStaff: Number(totalStaff),
    })
  }

  const [setting] = await db
    .select({ value: clinicSettings.value })
    .from(clinicSettings)
    .where(eq(clinicSettings.key, BREAKFAST_NOTIFY_KEY))
    .limit(1)
  const notificationsEnabled =
    (setting?.value as { enabled?: boolean } | undefined)?.enabled !== false

  return c.json({ success: true, data: { inventory, submissions, notificationsEnabled } })
})

// PATCH /api/breakfast/settings — enable/disable breakfast notifications (admin).
breakfastApp.patch('/settings', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await canAccessBreakfast(c, user.id, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)
  const db = getDb(process.env.DATABASE_URL!)
  const body = (await c.req.json().catch(() => ({}))) as { enabled?: boolean }
  const enabled = body.enabled !== false
  await db
    .insert(clinicSettings)
    .values({ key: BREAKFAST_NOTIFY_KEY, value: { enabled } })
    .onConflictDoUpdate({ target: clinicSettings.key, set: { value: { enabled } } })
  return c.json({ success: true, data: { notificationsEnabled: enabled } })
})

export { breakfastApp }
