/**
 * CRM — campaign data endpoints + ad template CRUD.
 *
 * Campaign queries derive data from existing tables (no new storage):
 *   GET  /api/crm/follow-ups   — appointments completed 48–72h ago
 *   GET  /api/crm/recare-due   — active recare plans due within 30 days
 *   GET  /api/crm/birthdays    — patients with a birthday in the next 7 days
 *   POST /api/crm/audience     — §13.4 audience builder: resolve filters
 *                                (treatment-type / tags / fixed segment) to a
 *                                recipient list + count, opt-out applied.
 *
 * Ad templates are persisted in `ad_templates`:
 *   GET/POST/PATCH/DELETE /api/crm/ad-templates[/:id]
 */

import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { type DB, getDb } from '../db'
import { adTemplates } from '../db/schema'
import { appointments, medicalRecords, recarePlans } from '../db/schema/clinical'
import { patientTagLinks } from '../db/schema/patient-tags'
import { patients } from '../db/schema/patients'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const crmApp = new Hono<HonoEnv>()

// ── Follow-ups ────────────────────────────────────────────────────────────────

crmApp.get('/follow-ups', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.PATIENTS as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const now = new Date()
  const ago48h = new Date(now.getTime() - 48 * 60 * 60 * 1000)
  const ago72h = new Date(now.getTime() - 72 * 60 * 60 * 1000)

  const rows = await db
    .select({
      id: appointments.id,
      patientId: appointments.patientId,
      patientName: patients.name,
      phone: patients.phone,
      completedAt: appointments.completedAt,
    })
    .from(appointments)
    .innerJoin(patients, eq(appointments.patientId, patients.id))
    .where(
      and(
        eq(appointments.status, 'completed'),
        gte(appointments.completedAt, ago72h),
        lte(appointments.completedAt, ago48h),
        eq(patients.doNotContact, false) // §13.3 — exclude opted-out patients
      )
    )
    .orderBy(asc(appointments.completedAt))

  const data = rows.map((r) => ({
    id: r.id,
    patientId: r.patientId,
    patientName: r.patientName,
    phone: r.phone ?? '',
    context: `Completed visit ${r.completedAt ? new Date(r.completedAt).toLocaleDateString('en-GH', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}`,
    dueAt: r.completedAt?.toISOString() ?? null,
    status: 'pending' as const,
  }))

  return c.json({ success: true, data })
})

// ── Recare due ──────────────────────────────────────────────────────────────

crmApp.get('/recare-due', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.PATIENTS as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const now = new Date()
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

  const rows = await db
    .select({
      id: recarePlans.id,
      patientId: recarePlans.patientId,
      patientName: patients.name,
      phone: patients.phone,
      nextAlertDate: recarePlans.nextAlertDate,
    })
    .from(recarePlans)
    .innerJoin(patients, eq(recarePlans.patientId, patients.id))
    .where(
      and(
        eq(recarePlans.status, 'pending'),
        eq(recarePlans.isActive, true),
        lte(recarePlans.nextAlertDate, in30Days),
        eq(patients.doNotContact, false) // §13.3 — exclude opted-out patients
      )
    )
    .orderBy(asc(recarePlans.nextAlertDate))

  const data = rows.map((r) => ({
    id: r.id,
    patientId: r.patientId,
    patientName: r.patientName,
    phone: r.phone ?? '',
    context: `Recare due ${r.nextAlertDate ? new Date(r.nextAlertDate).toLocaleDateString('en-GH', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}`,
    dueAt: r.nextAlertDate?.toISOString() ?? null,
    status: 'pending' as const,
  }))

  return c.json({ success: true, data })
})

// ── Birthdays ─────────────────────────────────────────────────────────────────

crmApp.get('/birthdays', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.PATIENTS as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)

  // Match patients whose birthday (month+day) falls within the next 7 days.
  // MMDD comparison doesn't handle Dec→Jan wrap but is good for typical use.
  const rows = await db
    .select({
      id: patients.id,
      name: patients.name,
      phone: patients.phone,
      dob: patients.dob,
    })
    .from(patients)
    .where(
      and(
        sql`TO_CHAR(${patients.dob}, 'MMDD') BETWEEN TO_CHAR(NOW(), 'MMDD') AND TO_CHAR(NOW() + INTERVAL '7 days', 'MMDD')`,
        eq(patients.doNotContact, false) // §13.3 — exclude opted-out patients
      )
    )
    .orderBy(sql`TO_CHAR(${patients.dob}, 'MMDD')`)

  const data = rows.map((r) => ({
    id: r.id,
    patientId: r.id,
    patientName: r.name,
    phone: r.phone ?? '',
    context: `Birthday ${r.dob ? new Date(r.dob).toLocaleDateString('en-GH', { month: 'long', day: 'numeric' }) : ''}`,
    dueAt: (() => {
      if (!r.dob) return null
      const dob = new Date(r.dob)
      const now = new Date()
      const thisYearBirthday = new Date(now.getFullYear(), dob.getMonth(), dob.getDate())
      if (thisYearBirthday < now) thisYearBirthday.setFullYear(now.getFullYear() + 1)
      return thisYearBirthday.toISOString()
    })(),
    status: 'pending' as const,
  }))

  return c.json({ success: true, data })
})

// ── Audience builder (§13.4) ────────────────────────────────────────────────
//
// Resolves a set of combinable filters to the matching patients + a recipient
// count, ALWAYS excluding do-not-contact patients (§18.1). Filters AND together:
// a patient must satisfy every supplied filter.
//
//   treatmentTypeId — patients who have a medical_records row of that type
//   tagIds[]        — patients linked to ANY of the given §2.7 tags
//   segment         — one of the fixed CRM segments (mirrors the GET views):
//                       follow_up — appointment completed 48–72h ago
//                       recare    — active recare plan due within 30 days
//                       birthday  — birthday in the next 7 days
//                       all       — no segment constraint
//
// The result shape is intentionally the same `{ patientId, patientName, phone }`
// recipient row the existing send path (`POST /api/sms/send`) consumes, so the
// audience builder stays composable with it.

export const AUDIENCE_SEGMENTS = ['follow_up', 'recare', 'birthday', 'all'] as const
export type AudienceSegment = (typeof AUDIENCE_SEGMENTS)[number]

export interface AudienceFilters {
  treatmentTypeId?: string | null
  tagIds?: string[]
  segment?: AudienceSegment
}

export interface AudienceRecipient {
  patientId: string
  patientName: string
  phone: string
}

export interface AudienceResult {
  recipients: AudienceRecipient[]
  count: number
}

const audienceSchema = z.object({
  treatmentTypeId: z.string().uuid().nullish(),
  tagIds: z.array(z.string().uuid()).optional(),
  segment: z.enum(AUDIENCE_SEGMENTS).optional(),
})

/**
 * Resolve audience filters to a recipient list. Pure data fn (takes the db/tx
 * handle) so it is exercised directly by the integration smoke test.
 */
export async function resolveAudience(db: DB, filters: AudienceFilters): Promise<AudienceResult> {
  const { treatmentTypeId, tagIds, segment } = filters

  // §13.3/§18.1: opt-out is enforced unconditionally — an opted-out patient can
  // never appear in an audience, regardless of which filters are supplied.
  const conditions = [eq(patients.doNotContact, false)]

  // ── treatment-type filter — patients with a record of that treatment type ──
  if (treatmentTypeId) {
    conditions.push(
      inArray(
        patients.id,
        db
          .select({ id: medicalRecords.patientId })
          .from(medicalRecords)
          .where(eq(medicalRecords.treatmentTypeId, treatmentTypeId))
      )
    )
  }

  // ── tag filter — patients linked to ANY of the given tags (§2.7) ───────────
  if (tagIds && tagIds.length > 0) {
    conditions.push(
      inArray(
        patients.id,
        db
          .select({ id: patientTagLinks.patientId })
          .from(patientTagLinks)
          .where(inArray(patientTagLinks.tagId, tagIds))
      )
    )
  }

  // ── fixed-segment filter (mirrors the GET campaign views) ──────────────────
  if (segment && segment !== 'all') {
    const now = new Date()
    if (segment === 'follow_up') {
      const ago48h = new Date(now.getTime() - 48 * 60 * 60 * 1000)
      const ago72h = new Date(now.getTime() - 72 * 60 * 60 * 1000)
      conditions.push(
        inArray(
          patients.id,
          db
            .select({ id: appointments.patientId })
            .from(appointments)
            .where(
              and(
                eq(appointments.status, 'completed'),
                gte(appointments.completedAt, ago72h),
                lte(appointments.completedAt, ago48h)
              )
            )
        )
      )
    } else if (segment === 'recare') {
      const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
      conditions.push(
        inArray(
          patients.id,
          db
            .select({ id: recarePlans.patientId })
            .from(recarePlans)
            .where(
              and(
                eq(recarePlans.status, 'pending'),
                eq(recarePlans.isActive, true),
                lte(recarePlans.nextAlertDate, in30Days)
              )
            )
        )
      )
    } else if (segment === 'birthday') {
      conditions.push(
        sql`TO_CHAR(${patients.dob}, 'MMDD') BETWEEN TO_CHAR(NOW(), 'MMDD') AND TO_CHAR(NOW() + INTERVAL '7 days', 'MMDD')`
      )
    }
  }

  const rows = await db
    .select({ id: patients.id, name: patients.name, phone: patients.phone })
    .from(patients)
    .where(and(...conditions))
    .orderBy(asc(patients.name))

  const recipients: AudienceRecipient[] = rows.map((r) => ({
    patientId: r.id,
    patientName: r.name,
    phone: r.phone ?? '',
  }))

  return { recipients, count: recipients.length }
}

crmApp.post('/audience', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.MESSAGING as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const parsed = audienceSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) {
    return c.json({ error: 'Invalid filters', details: parsed.error.flatten() }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const result = await resolveAudience(db, parsed.data)
  return c.json({ success: true, data: result })
})

// ── Ad Templates ──────────────────────────────────────────────────────────────

crmApp.get('/ad-templates', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.MESSAGING as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db.select().from(adTemplates).orderBy(asc(adTemplates.name))
  return c.json({ success: true, data: rows })
})

crmApp.post('/ad-templates', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.MESSAGING as string, ACTIONS.CREATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const body = await c.req.json()
  if (!body.name?.trim()) return c.json({ error: 'name required' }, 400)
  if (!body.body?.trim()) return c.json({ error: 'body required' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .insert(adTemplates)
    .values({ name: body.name.trim(), body: body.body.trim() })
    .returning()
  return c.json({ success: true, data: row }, 201)
})

/** Editable fields on an ad template. zod trims and drops everything else. */
const updateAdTemplateSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    body: z.string().trim().min(1).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Supply at least one updatable field',
  })

crmApp.patch('/ad-templates/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.MESSAGING as string, ACTIONS.UPDATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  // Unguarded `c.req.json()` used to throw on a non-JSON or `null` body and
  // escape to the global handler as a 500. A malformed request is a 400.
  const parsed = updateAdTemplateSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
  }
  const db = getDb(process.env.DATABASE_URL!)
  const updates = { updatedAt: new Date(), ...parsed.data }

  const [row] = await db.update(adTemplates).set(updates).where(eq(adTemplates.id, id)).returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true, data: row })
})

crmApp.delete('/ad-templates/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.MESSAGING as string, ACTIONS.DELETE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db.delete(adTemplates).where(eq(adTemplates.id, id)).returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true })
})

export { crmApp }
