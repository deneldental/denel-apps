import { asc, eq, or, sql } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db'
import {
  allergies,
  appointments,
  appointmentTypes,
  caseStages,
  categories,
  complianceTags,
  dentalReviewItems,
  drugFrequencies,
  drugHistoryItems,
  employmentTypes,
  examinationTypes,
  expenseCategories,
  expenses,
  hrDepartments,
  items,
  labCaseStatuses,
  medicalRecords,
  orthoTreatments,
  pastMedicalHistory,
  paymentMethods,
  payments,
  presentingComplaints,
  services,
  socialHistoryItems,
  specialties,
  staffDocuments,
  staffDocumentTypes,
  staffTitles,
  treatmentPlanItems,
  treatmentTypes,
  units,
} from '../db/schema'
import { LOOKUP_READ_RULES } from '../lib/lookup-access'
import { ACTIONS, MODULES } from '../lib/modules'
import { isUniqueViolation } from '../lib/pg-errors'
import { checkPermission, getCurrentUser, isAdmin } from '../lib/rbac'
import { denyUnless } from '../lib/route-access'
import type { HonoEnv } from '../lib/types'

const lookupsApp = new Hono<HonoEnv>()

const tables: Record<string, any> = {
  'expense-categories': expenseCategories,
  'payment-methods': paymentMethods,
  categories: categories,
  units: units,
  'appointment-types': appointmentTypes,
  // Imaging / clinical lookups owned by their own settings sections but exposed
  // through the same /api/lookups/:type interface for consistency.
  'examination-types': examinationTypes,
  'treatment-types': treatmentTypes,
  // Clinical stage option lookups (v2)
  'presenting-complaints': presentingComplaints,
  'past-medical-history': pastMedicalHistory,
  'drug-history-items': drugHistoryItems,
  allergies: allergies,
  'social-history-items': socialHistoryItems,
  'dental-review-items': dentalReviewItems,
  'ortho-treatments': orthoTreatments,
  'drug-frequencies': drugFrequencies,
  // Lab case workflow statuses (admin-v1 §8.3)
  'lab-case-statuses': labCaseStatuses,
  // HR staff document categorisation (Phase H slice 4)
  'staff-document-types': staffDocumentTypes,
  // Clinical position / Title (self-registration + staff record)
  'staff-titles': staffTitles,
  // HR employment + org lookups (migration 0178) — were hard-coded enums.
  'employment-types': employmentTypes,
  'hr-departments': hrDepartments,
  // Clinical specialisation (migration 0179) — was free text on specialists.
  specialties: specialties,
  'compliance-tags': complianceTags,
}

// Reading a lookup list needs the modules whose screens use it (lib/lookup-access.ts). A type
// without a rule would be readable by nobody, so refuse to load rather than discover it in production.
export const LOOKUP_TYPES = Object.keys(tables)
for (const type of LOOKUP_TYPES) {
  if (!LOOKUP_READ_RULES[type]) throw new Error(`lookups: no read rule for the "${type}" type`)
}

const HR_LOOKUP_TYPES = new Set([
  'staff-document-types',
  'staff-titles',
  'employment-types',
  'hr-departments',
  'specialties',
])

/** Admin may write any lookup; `staff:update` may also write the HR ones. */
async function canWriteLookup(c: Context<HonoEnv>, userId: string, type: string) {
  if (await isAdmin(c, userId)) return true
  return (
    HR_LOOKUP_TYPES.has(type) &&
    (await checkPermission(c, userId, MODULES.STAFF as string, ACTIONS.UPDATE as string))
  )
}

// ── Usage-check registry ─────────────────────────────────────────────────────
// Hard deletion of a lookup row is gated on this check: if the row is
// referenced anywhere, DELETE returns 409 and the caller is told to deactivate
// the row instead (PATCH isActive=false). Each checker is type-specific because
// references live in different columns — text columns by name, FK columns by
// id, and jsonb blobs by either.

type LookupRow = { id: string; name: string; displayName?: string | null }
type UsageResult = { count: number; refLabel: string } | null
type UsageChecker = (db: ReturnType<typeof getDb>, row: LookupRow) => Promise<UsageResult>

const noUsage: UsageChecker = async () => null

async function countRows(
  db: ReturnType<typeof getDb>,
  whereSql: ReturnType<typeof sql>
): Promise<number> {
  const result = (await db.execute(
    sql`SELECT count(*)::int AS c FROM (${whereSql}) AS sub`
  )) as unknown as { rows: Array<{ c: number }> }
  return result.rows?.[0]?.c ?? 0
}

const USAGE_CHECKS: Record<string, UsageChecker> = {
  // §8.3: lab case statuses — no hard FK; safe to delete
  'lab-case-statuses': async (_db, _row) => null,
  // Titles are stored on staff.position by displayName; deletion is allowed
  // (deactivate is the recommended path for an in-use title).
  'staff-titles': noUsage,
  'compliance-tags': noUsage,
  // staff.employmentType / staff.department FK to these by `name` (0178), so a
  // delete of an in-use row would fail on the constraint. Check first and
  // return the registry's 409 ("deactivate instead") rather than a raw 500.
  'employment-types': async (db, row) => {
    const count = await countRows(
      db,
      sql`SELECT 1 FROM "staff" WHERE "employmentType" = ${row.name} AND "deletedAt" IS NULL`
    )
    return count ? { count, refLabel: 'staff member' } : null
  },
  specialties: async (db, row) => {
    const count = await countRows(
      db,
      sql`SELECT 1 FROM "specialists" WHERE "specialty" = ${row.name} AND "is_active" = true`
    )
    return count ? { count, refLabel: 'specialist' } : null
  },
  'hr-departments': async (db, row) => {
    const count = await countRows(
      db,
      sql`SELECT 1 FROM "staff" WHERE "department" = ${row.name} AND "deletedAt" IS NULL`
    )
    return count ? { count, refLabel: 'staff member' } : null
  },
  'staff-document-types': async (db, row) => {
    const [r] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(staffDocuments)
      .where(eq(staffDocuments.documentType, row.name))
    const count = r?.count ?? 0
    return count > 0 ? { count, refLabel: 'staff document(s)' } : null
  },
  'appointment-types': async (db, row) => {
    const [r] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(appointments)
      .where(eq(appointments.type, row.name))
    const count = r?.count ?? 0
    return count > 0 ? { count, refLabel: 'appointment(s)' } : null
  },
  'examination-types': async (db, row) => {
    // Stored inside case_stages.data as `examTypeId` at the top level.
    const [r] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(caseStages)
      .where(sql`${caseStages.data}->>'examTypeId' = ${row.id}`)
    const count = r?.count ?? 0
    return count > 0 ? { count, refLabel: 'case stage(s)' } : null
  },
  'treatment-types': async (db, row) => {
    const [items] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(treatmentPlanItems)
      .where(eq(treatmentPlanItems.treatmentTypeId, row.id))
    const [records] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(medicalRecords)
      .where(eq(medicalRecords.treatmentTypeId, row.id))
    const [svcs] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(services)
      .where(eq(services.treatmentTypeId, row.id))
    const count = (items?.count ?? 0) + (records?.count ?? 0) + (svcs?.count ?? 0)
    return count > 0 ? { count, refLabel: 'treatment record(s)' } : null
  },
  // Clinical stage lookups — stored as `{ id, name, displayName }` snapshots
  // inside `case_stages.data` under various keys. We check all the keys this
  // app writes; if any contains the id, the row is in use.
  'presenting-complaints': caseStageItemsCheck(['items']),
  'past-medical-history': caseStageItemsCheck(['items']),
  'drug-history-items': caseStageItemsCheck(['drugs']),
  allergies: caseStageItemsCheck(['allergies']),
  'social-history-items': caseStageItemsCheck(['items']),
  'dental-review-items': caseStageItemsCheck(['items']),
  'ortho-treatments': caseStageItemsCheck(['currentTreatments', 'nextTreatments']),
  // drug-frequencies are stored by display value, not id — we can't usefully
  // detect usage without scanning every prescription, so we allow deletion.
  'drug-frequencies': noUsage,
  // Finance + stock lookups are referenced by slug from text columns
  // (settings-domain-audit B6). A hard delete used to orphan every row that
  // named them — and, for a payment method, its GL channel mapping with it.
  'payment-methods': async (db, row) => {
    const [pay] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(payments)
      .where(eq(payments.method, row.name))
    const [exp] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(expenses)
      .where(eq(expenses.paymentMethod, row.name))
    const count = (pay?.count ?? 0) + (exp?.count ?? 0)
    return count > 0 ? { count, refLabel: 'payment(s) or expense(s)' } : null
  },
  'expense-categories': async (db, row) => {
    const [r] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(expenses)
      .where(eq(expenses.category, row.name))
    const count = r?.count ?? 0
    return count > 0 ? { count, refLabel: 'expense(s)' } : null
  },
  units: async (db, row) => {
    const [r] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(items)
      .where(eq(items.unit, row.name))
    const count = r?.count ?? 0
    return count > 0 ? { count, refLabel: 'item(s)' } : null
  },
  // items point at a category by id (§11.6) or, on legacy rows, by name.
  categories: async (db, row) => {
    const [r] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(items)
      .where(or(eq(items.categoryId, row.id), eq(items.category, row.name)))
    const count = r?.count ?? 0
    return count > 0 ? { count, refLabel: 'item(s)' } : null
  },
}

function caseStageItemsCheck(keys: string[]): UsageChecker {
  return async (db, row) => {
    const idJson = JSON.stringify([{ id: row.id }])
    const conditions = keys.map((key) => sql`${caseStages.data}->${key} @> ${idJson}::jsonb`)
    const [r] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(caseStages)
      .where(or(...conditions))
    const count = r?.count ?? 0
    return count > 0 ? { count, refLabel: 'case stage(s)' } : null
  }
}

// Reference the helper so unused-binding lints don't flag it before the map
// is consumed (some tooling reads top-to-bottom).
void countRows

// ── Input schemas ─────────────────────────────────────────────────────────────
// Only client-settable columns are listed. Identity/audit columns (id,
// createdAt, updatedAt) are always server-owned and are intentionally absent so
// they can never be supplied by the client. Unknown keys are stripped by zod's
// default behaviour (no .strict()).

// Shape shared by the majority of lookup tables:
//   name · displayName · isActive
// Additional columns that only some tables carry (colour, autoSyncEnabled,
// defaultRecareMonths) are listed as optional so the same schema works for all
// types through the generic route.
const LookupCreateSchema = z.object({
  name: z.string().min(1),
  displayName: z.string().nullish(),
  colour: z.string().nullish(),
  // payment-methods only: the GL cash/bank/clearing account code this method's
  // receipts post to (see lib/channel-accounts.ts). Constrained to a known
  // channel by the Settings UI, not free text.
  glAccountCode: z.string().nullish(),
  // employment-types only: the behaviour class code keys off. Admins pick it
  // at creation (it decides whether a contract end date applies) but it is
  // never free text — the DB CHECKs it.
  kind: z.enum(['permanent', 'contract', 'trainer']).optional(),
})

const LookupPatchSchema = z.object({
  name: z.string().min(1).optional(),
  displayName: z.string().nullish(),
  isActive: z.boolean().optional(),
  colour: z.string().nullish(),
  glAccountCode: z.string().nullish(),
  kind: z.enum(['permanent', 'contract', 'trainer']).optional(),
  autoSyncEnabled: z.boolean().optional(),
  defaultRecareMonths: z.number().int().nonnegative().nullish(),
})

// ── Handlers ─────────────────────────────────────────────────────────────────

// GET /api/lookups/:type - Fetch active records
lookupsApp.get('/:type', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const type = c.req.param('type')
  const table = tables[type]
  if (!table) return c.json({ error: 'Invalid lookup type' }, 400)
  const denied = await denyUnless(c, user.id, LOOKUP_READ_RULES[type])
  if (denied) return denied

  const db = getDb(process.env.DATABASE_URL!)

  try {
    const data = await db
      .select()
      .from(table)
      .where(eq(table.isActive, true))
      .orderBy(asc(table.name))
    return c.json({ success: true, data })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

// GET /api/lookups/:type/all - Fetch all records (Admin sees inactive too)
lookupsApp.get('/:type/all', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const type = c.req.param('type')
  const table = tables[type]
  if (!table) return c.json({ error: 'Invalid lookup type' }, 400)
  const denied = await denyUnless(c, user.id, LOOKUP_READ_RULES[type])
  if (denied) return denied

  const db = getDb(process.env.DATABASE_URL!)

  try {
    // Inactive rows are shown to whoever may write this type — the same gate
    // POST/PATCH/DELETE apply — so an HR admin who deactivated a title can see
    // it and reactivate it (settings-domain-audit D5).
    if (!(await canWriteLookup(c, user.id, type))) {
      const data = await db
        .select()
        .from(table)
        .where(eq(table.isActive, true))
        .orderBy(asc(table.name))
      return c.json({ success: true, data })
    }

    const data = await db.select().from(table).orderBy(asc(table.name))
    return c.json({ success: true, data })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

// POST /api/lookups/:type - Create record (Admin only)
lookupsApp.post('/:type', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const type = c.req.param('type')
  const table = tables[type]
  if (!table) return c.json({ error: 'Invalid lookup type' }, 400)

  const db = getDb(process.env.DATABASE_URL!)

  try {
    const isHrLookup = HR_LOOKUP_TYPES.has(type)
    const hasAccess =
      (await isAdmin(c, user.id)) ||
      (isHrLookup &&
        (await checkPermission(c, user.id, MODULES.STAFF as string, ACTIONS.UPDATE as string)))
    if (!hasAccess) return c.json({ error: 'Unauthorized' }, 403)

    const parsed = LookupCreateSchema.safeParse(await c.req.json())
    if (!parsed.success)
      return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
    const body = parsed.data
    const insertPayload: Record<string, unknown> = {
      name: body.name.toLowerCase().trim(),
      displayName: body.displayName?.trim() || null,
    }
    if (
      typeof body.colour === 'string' &&
      body.colour.trim() &&
      'colour' in (table as Record<string, unknown>)
    ) {
      insertPayload.colour = body.colour.trim()
    }
    // employment-types carries `kind` — the behaviour class code keys off.
    if (typeof body.kind === 'string' && 'kind' in (table as Record<string, unknown>)) {
      insertPayload.kind = body.kind
    }
    // payment-methods carries `glAccountCode` — the GL channel account its
    // receipts post to (see lib/channel-accounts.ts).
    if (
      typeof body.glAccountCode === 'string' &&
      body.glAccountCode.trim() &&
      'glAccountCode' in (table as Record<string, unknown>)
    ) {
      insertPayload.glAccountCode = body.glAccountCode.trim()
    }
    const [newItem] = (await db.insert(table).values(insertPayload).returning()) as LookupRow[]

    return c.json({ success: true, data: newItem })
  } catch (error: unknown) {
    if (isUniqueViolation(error)) {
      return c.json({ error: 'Already exists' }, 400)
    }
    return c.json({ error: 'Failed' }, 500)
  }
})

// PATCH /api/lookups/:type/:id - Update record (Admin only)
lookupsApp.patch('/:type/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const type = c.req.param('type')
  const id = c.req.param('id')
  const table = tables[type]
  if (!table) return c.json({ error: 'Invalid lookup type' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const isHrLookup = HR_LOOKUP_TYPES.has(type)
    const hasAccess =
      (await isAdmin(c, user.id)) ||
      (isHrLookup &&
        (await checkPermission(c, user.id, MODULES.STAFF as string, ACTIONS.UPDATE as string)))
    if (!hasAccess) return c.json({ error: 'Unauthorized' }, 403)

    const parsed = LookupPatchSchema.safeParse(await c.req.json())
    if (!parsed.success)
      return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
    const data = { ...parsed.data }

    if (typeof data.name === 'string') {
      // The slug is what referencing rows store as text, so changing it on a
      // row that is in use orphans them exactly like a delete would — same
      // guard, same 409, same "deactivate instead" (settings-domain-audit B7).
      data.name = data.name.toLowerCase().trim()
      const [current] = (await db.select().from(table).where(eq(table.id, id)).limit(1)) as Array<
        LookupRow & Record<string, unknown>
      >
      if (!current) return c.json({ error: 'Not found' }, 404)
      if (current.name !== data.name) {
        const usage = await (USAGE_CHECKS[type] ?? noUsage)(db, current)
        if (usage) {
          return c.json(
            {
              error: `In use by ${usage.count} ${usage.refLabel}. The internal name cannot change while it is referenced — deactivate it and create a new one, or change the display name only.`,
              code: 'LOOKUP_IN_USE',
              count: usage.count,
              refLabel: usage.refLabel,
            },
            409
          )
        }
      }
    }

    await db.update(table).set(data).where(eq(table.id, id))
    return c.json({ success: true })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

// DELETE /api/lookups/:type/:id - Hard delete, guarded by usage check.
// If the row is referenced anywhere we know about, return 409 + reference info
// so the UI can suggest deactivating instead. Lookups without a registered
// checker fall through to a plain delete.
lookupsApp.delete('/:type/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const type = c.req.param('type')
  const id = c.req.param('id')
  const table = tables[type]
  if (!table) return c.json({ error: 'Invalid lookup type' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const isHrLookup = HR_LOOKUP_TYPES.has(type)
    const hasAccess =
      (await isAdmin(c, user.id)) ||
      (isHrLookup &&
        (await checkPermission(c, user.id, MODULES.STAFF as string, ACTIONS.UPDATE as string)))
    if (!hasAccess) return c.json({ error: 'Unauthorized' }, 403)

    const [row] = (await db.select().from(table).where(eq(table.id, id)).limit(1)) as Array<
      LookupRow & Record<string, unknown>
    >
    if (!row) return c.json({ error: 'Not found' }, 404)

    const check = USAGE_CHECKS[type] ?? noUsage
    const usage = await check(db, row)
    if (usage) {
      return c.json(
        {
          error: `In use by ${usage.count} ${usage.refLabel}. Deactivate it instead, or remove the references first.`,
          code: 'LOOKUP_IN_USE',
          count: usage.count,
          refLabel: usage.refLabel,
        },
        409
      )
    }

    await db.delete(table).where(eq(table.id, id))
    return c.json({ success: true })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to delete' }, 500)
  }
})

export { lookupsApp }
