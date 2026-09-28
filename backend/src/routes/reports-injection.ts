import { and, eq, gte, lte } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { INJECTION_SECTIONS, patients, reportsInjectionConfig } from '../db/schema'
import type { InjectionSection } from '../db/schema/operations'
import { createAuditLog } from '../lib/audit'
import { ACTIONS, MODULES, ROLES } from '../lib/modules'
import { partitionByTags } from '../lib/patient-tags-query'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import { type PiiScopeMode, resolvePiiScope, scopePayloadPii } from '../lib/reports-injection-pii'
import type { HonoEnv } from '../lib/types'

const reportsInjectionApp = new Hono<HonoEnv>()

const MODULE = MODULES.DATA_INJECT

// ── Helpers ───────────────────────────────────────────────────────────────────

function isValidSection(s: unknown): s is InjectionSection {
  return typeof s === 'string' && (INJECTION_SECTIONS as readonly string[]).includes(s)
}

async function _isAdmin(userId: string): Promise<boolean> {
  const db = getDb(process.env.DATABASE_URL!)
  const { user: userSchema } = await import('../db/schema/auth')
  const row = await db.query.user.findFirst({ where: eq(userSchema.id, userId) })
  return (row as any)?.roleId === ROLES.ADMIN
}

// ── Publish payload builders ──────────────────────────────────────────────────
// Build the rows a section would push to the reports DB, honouring the section's
// stored filters (categories / date range / limit). The rows are returned RAW
// (PII intact); the publish handler applies the §22.2 PII-scoping transform
// before anything crosses the DB boundary.

const MAX_PUBLISH_LIMIT = 10_000

type SectionConfig = {
  categories?: string[]
  dateFrom?: string
  dateTo?: string
  limit?: number
  piiScope?: PiiScopeMode
}

export async function buildSectionPayload(
  db: ReturnType<typeof getDb>,
  section: InjectionSection,
  config: SectionConfig
): Promise<Record<string, unknown>[]> {
  // Only patient_records carries direct patient PII today; the other sections
  // are aggregate/config surfaces with no row-level patient identifiers, so they
  // have nothing to scope and publish nothing here (handled by their own ETL).
  if (section !== 'patient_records') return []

  const conds = []
  if (config.dateFrom) conds.push(gte(patients.createdAt, new Date(config.dateFrom)))
  if (config.dateTo) conds.push(lte(patients.createdAt, new Date(config.dateTo)))

  const limit = Math.min(Math.max(Number(config.limit) || 500, 1), MAX_PUBLISH_LIMIT)

  const rows = await db
    .select()
    .from(patients)
    .where(conds.length > 0 ? and(...conds) : undefined)
    .limit(limit)

  const cats = config.categories
  if (!cats || cats.length === 0) return rows as Record<string, unknown>[]

  // §2.7: the legacy "type"/isOrtho category labels (ortho/general/external) are
  // now derived from the patient_tags junction. Classify the fetched rows against
  // their tag membership in-memory (one flat junction query); `category` stays a
  // real column.
  const { ortho, external } = await partitionByTags(
    db,
    rows.map((p) => p.id)
  )
  const matched = rows.filter((p) => {
    const matchCategory = cats.includes(p.category)
    const matchOrtho = cats.includes('ortho') && ortho.has(p.id)
    const matchExternal = cats.includes('external') && external.has(p.id)
    const matchGeneral = cats.includes('general') && !ortho.has(p.id) && !external.has(p.id)
    return matchCategory || matchOrtho || matchExternal || matchGeneral
  })

  return matched as Record<string, unknown>[]
}

// ── GET /api/reports-injection ─────────────────────────────────────────────
// Portal: returns all 7 section rows (enabled or not) so the Data-Inject UI
// can show current state for every section.
// Reports app: same endpoint — returns the full list; the client filters by
// `enabled` to decide which sections to render.
reportsInjectionApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db
    .select()
    .from(reportsInjectionConfig)
    .orderBy(reportsInjectionConfig.section)

  // Ensure all 7 sections are represented even on a fresh install with no DB rows
  const rowMap = new Map(rows.map((r) => [r.section, r]))
  const normalized = INJECTION_SECTIONS.map(
    (section) =>
      rowMap.get(section) ?? {
        id: '',
        section,
        enabled: false,
        config: {},
        updatedById: null,
        updatedAt: new Date(),
      }
  )

  return c.json({ success: true, data: normalized })
})

// ── PUT /api/reports-injection/:section ───────────────────────────────────
// Portal admin only. Creates or updates the config for a single section.
// Body: { enabled: boolean, config: object }
reportsInjectionApp.put('/:section', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const section = c.req.param('section')
  if (!isValidSection(section))
    return c.json(
      { error: `Invalid section. Must be one of: ${INJECTION_SECTIONS.join(', ')}` },
      400
    )

  const body = (await c.req.json().catch(() => ({}))) as {
    enabled?: boolean
    config?: Record<string, unknown>
  }

  if (typeof body.enabled !== 'boolean')
    return c.json({ error: "'enabled' (boolean) is required" }, 400)

  const db = getDb(process.env.DATABASE_URL!)

  const existing = await db.query.reportsInjectionConfig.findFirst({
    where: eq(reportsInjectionConfig.section, section),
  })

  c.set('skipAudit', true)

  if (existing) {
    const [updated] = await db
      .update(reportsInjectionConfig)
      .set({
        enabled: body.enabled,
        config: body.config ?? existing.config,
        updatedById: user.id,
        updatedAt: new Date(),
      })
      .where(eq(reportsInjectionConfig.section, section))
      .returning()

    await createAuditLog(db, {
      userId: user.id,
      action: 'update',
      module: 'data_inject',
      entityId: updated.id,
      entityName: `Reports injection — ${section}`,
      changes: {
        before: { enabled: existing.enabled, config: existing.config },
        after: { enabled: updated.enabled, config: updated.config },
      },
    })

    return c.json({ success: true, data: updated })
  }

  // Row should always exist (seeded by migration), but handle the edge case.
  const [inserted] = await db
    .insert(reportsInjectionConfig)
    .values({
      section,
      enabled: body.enabled,
      config: body.config ?? {},
      updatedById: user.id,
    })
    .returning()

  await createAuditLog(db, {
    userId: user.id,
    action: 'create',
    module: 'data_inject',
    entityId: inserted.id,
    entityName: `Reports injection — ${section}`,
    changes: { enabled: inserted.enabled, config: inserted.config },
  })

  return c.json({ success: true, data: inserted }, 201)
})

// ── POST /api/reports-injection/:section/publish ──────────────────────────────
// admin-v1 §22.1 + §22.2. Produces the payload that crosses into the reports
// app's separate DB for one section, applying the section's PII-scoping option
// (§22.2: include / omit / mask sensitive patient PII) BEFORE the data leaves
// this DB, and writes a publish audit row (§22.1: who moved which section, when,
// how many rows, under which PII scope — DPA accountability for cross-DB
// movement). Admin-gated; the section must be enabled.
reportsInjectionApp.post('/:section/publish', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  // Cross-DB data movement is a CREATE on the reports DB (mirrors sync.ts).
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const section = c.req.param('section')
  if (!isValidSection(section))
    return c.json(
      { error: `Invalid section. Must be one of: ${INJECTION_SECTIONS.join(', ')}` },
      400
    )

  const db = getDb(process.env.DATABASE_URL!)

  const cfgRow = await db.query.reportsInjectionConfig.findFirst({
    where: eq(reportsInjectionConfig.section, section),
  })

  if (!cfgRow?.enabled)
    return c.json({ error: `Section '${section}' is not enabled for publishing.` }, 409)

  const config = (cfgRow.config ?? {}) as SectionConfig
  const piiScope = resolvePiiScope(config)

  // 1. Build the raw payload (PII intact) honouring the section's filters.
  const rawRows = await buildSectionPayload(db, section, config)

  // 2. §22.2 — scope PII (omit/mask/include) before anything crosses DBs.
  const scopedRows = scopePayloadPii(section, rawRows, piiScope)

  // NOTE: the actual cross-DB write to the reports app DB is handled by the ETL
  // transport (sync.ts / scheduled sync). This endpoint owns producing the
  // already-scoped payload + the accountability record for that movement.

  // 3. §22.1 — audit the publish: who, which section, when, row count, PII scope.
  c.set('skipAudit', true)
  await createAuditLog(db, {
    userId: user.id,
    action: 'publish',
    module: 'data_inject',
    entityId: cfgRow.id,
    entityName: `Reports injection publish — ${section}`,
    changes: {
      section,
      piiScope,
      rowCount: scopedRows.length,
      filters: {
        categories: config.categories ?? null,
        dateFrom: config.dateFrom ?? null,
        dateTo: config.dateTo ?? null,
        limit: config.limit ?? null,
      },
    },
  })

  return c.json({
    success: true,
    data: { section, piiScope, rowCount: scopedRows.length, rows: scopedRows },
  })
})

export { reportsInjectionApp }
