import type { PgTable } from 'drizzle-orm/pg-core'
import { type Context, Hono } from 'hono'
import { getDb } from '../db'
import * as schema from '../db/schema'
import { createAuditLog } from '../lib/audit'
import { getCurrentUser, isAdminUser } from '../lib/rbac'
import {
  IMPORTABLE_TABLES,
  MAX_IMPORT_ROWS,
  NOT_FROM_A_FILE,
  parseImportCsv,
  prepareImport,
  rowsFromRecords,
  templateColumns,
} from '../lib/table-import'
import type { HonoEnv } from '../lib/types'

const databaseApp = new Hono<HonoEnv>()

const TABLE_MAP: Record<string, PgTable> = {
  patients: schema.patients,
  appointments: schema.appointments,
  medical_records: schema.medicalRecords,
  pending_medical_records: schema.pendingMedicalRecords,
  payments: schema.payments,
  items: schema.items,
  treatment_types: schema.treatmentTypes,
  appointment_types: schema.appointmentTypes,
  expense_categories: schema.expenseCategories,
  payment_methods: schema.paymentMethods,
  units: schema.units,
  categories: schema.categories,
  payment_plans: schema.paymentPlans,
  payment_plan_templates: schema.paymentPlanTemplates,
  expenses: schema.expenses,
  doctors: schema.doctors,
  doctor_unavailability: schema.doctorUnavailability,
  sales: schema.sales,
  daily_reports: schema.dailyReports,
  sms_messages: schema.smsMessages,
  ortho_consent_forms: schema.orthoConsentForms,
  messages: schema.messages,
}

async function checkAdmin(c: Context<HonoEnv>) {
  const user = await getCurrentUser(c)
  return isAdminUser(user)
}

function clearAllowed(): boolean {
  return process.env.ALLOW_TABLE_CLEAR === 'true'
}

databaseApp.get('/tables', async (c) => {
  if (!(await checkAdmin(c))) return c.json({ error: 'Unauthorized' }, 403)
  return c.json({ success: true, data: Object.keys(TABLE_MAP).sort() })
})

// The tables a CSV may be loaded into (D10): the lookup tables only. /tables above is still every
// table, because export and clearing work on all of them.
databaseApp.get('/importable-tables', async (c) => {
  if (!(await checkAdmin(c))) return c.json({ error: 'Unauthorized' }, 403)
  return c.json({ success: true, data: Object.keys(IMPORTABLE_TABLES).sort() })
})

function notImportable(tableName: string) {
  return {
    error: `Importing into "${tableName}" is not allowed: only lookup tables can be imported, because the other tables are written by the screens that keep the ledger, patient numbers and the schedule correct.`,
    code: 'IMPORT_TABLE_NOT_ALLOWED',
  }
}

databaseApp.post('/clear-table', async (c) => {
  if (!(await checkAdmin(c))) return c.json({ error: 'Unauthorized' }, 403)
  if (!clearAllowed())
    return c.json({ error: 'Table clearing is disabled in this environment' }, 403)
  const user = await getCurrentUser(c)
  const { tableName } = await c.req.json()
  const table = TABLE_MAP[tableName]
  if (!table) return c.json({ error: 'Invalid table' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    await db.delete(table)
    await createAuditLog(db, {
      userId: user?.id ?? 'unknown',
      action: 'delete',
      module: 'database',
      entityId: tableName,
      entityName: `Table: ${tableName}`,
      changes: { action: 'clear-table', tableName },
    })
    return c.json({ success: true })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

databaseApp.post('/clear-all', async (c) => {
  if (!(await checkAdmin(c))) return c.json({ error: 'Unauthorized' }, 403)
  if (!clearAllowed())
    return c.json({ error: 'Table clearing is disabled in this environment' }, 403)
  const user = await getCurrentUser(c)
  const db = getDb(process.env.DATABASE_URL!)
  try {
    // Delete in order
    const tables = [
      schema.payments,
      schema.sales,
      schema.pendingMedicalRecords,
      schema.medicalRecords,
      schema.orthoConsentForms,
      schema.smsMessages,
      schema.doctorUnavailability,
      schema.appointments,
      schema.paymentPlans,
      schema.patients,
      schema.doctors,
      schema.dailyReports,
      schema.expenses,
      schema.paymentPlanTemplates,
      schema.messages,
      schema.treatmentTypes,
      schema.appointmentTypes,
      schema.expenseCategories,
      schema.paymentMethods,
      schema.units,
      schema.categories,
    ]

    // One transaction: a failure part-way must not leave some tables wiped and others not.
    await db.transaction(async (tx) => {
      for (const table of tables) {
        await tx.delete(table)
      }
    })
    await createAuditLog(db, {
      userId: user?.id ?? 'unknown',
      action: 'delete',
      module: 'database',
      entityId: 'all',
      entityName: 'All tables',
      changes: { action: 'clear-all' },
    })
    return c.json({ success: true })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

// How many left-out rows come back in the response (the total is always given).
const SKIPPED_REPORT_LIMIT = 200
const INSERT_CHUNK = 500

// POST /import/:tableName — load rows into a LOOKUP table (D10). The body is { csv: "<text>" }; a
// JSON list of records is still accepted and checked the same way. The server reads the CSV, checks
// every row against the table's columns, imports the good rows in one transaction and answers with
// the rows it left out and why. Rows whose unique name already exists are counted, not an error.
databaseApp.post('/import/:tableName', async (c) => {
  if (!(await checkAdmin(c))) return c.json({ error: 'Unauthorized' }, 403)
  const tableName = c.req.param('tableName')
  if (!TABLE_MAP[tableName]) return c.json({ error: 'Invalid table' }, 400)
  const table = IMPORTABLE_TABLES[tableName]
  if (!table) return c.json(notImportable(tableName), 403)

  const body: unknown = await c.req.json().catch(() => null)
  let parsed: { header: string[]; rows: ReturnType<typeof rowsFromRecords>['rows'] }
  if (Array.isArray(body)) {
    if (body.length === 0 || body.some((r) => !r || typeof r !== 'object' || Array.isArray(r))) {
      return c.json({ error: 'Send a non-empty list of records.' }, 400)
    }
    if (body.length > MAX_IMPORT_ROWS) {
      return c.json({ error: `At most ${MAX_IMPORT_ROWS} rows can be imported at once.` }, 400)
    }
    parsed = rowsFromRecords(body as Array<Record<string, unknown>>)
  } else if (body && typeof (body as { csv?: unknown }).csv === 'string') {
    const csv = parseImportCsv((body as { csv: string }).csv)
    if (!csv.ok) return c.json({ error: csv.error }, 400)
    parsed = csv
  } else {
    return c.json({ error: 'Send the CSV as { "csv": "<text>" }.' }, 400)
  }

  const prepared = prepareImport(table, parsed.header, parsed.rows, NOT_FROM_A_FILE[tableName])
  if (!prepared.ok) return c.json({ error: prepared.error }, 400)
  const { records, skipped } = prepared
  const report = skipped.slice(0, SKIPPED_REPORT_LIMIT)
  if (records.length === 0) {
    return c.json(
      {
        success: false,
        error: 'No rows could be imported: every row was left out.',
        skipped: report,
        skippedTotal: skipped.length,
      },
      400
    )
  }

  const db = getDb(process.env.DATABASE_URL!)
  const user = await getCurrentUser(c)
  try {
    let inserted = 0
    await db.transaction(async (tx) => {
      for (let i = 0; i < records.length; i += INSERT_CHUNK) {
        const rows = await tx
          .insert(table)
          .values(records.slice(i, i + INSERT_CHUNK) as never)
          .onConflictDoNothing()
          .returning()
        inserted += rows.length
      }
    })
    const existing = records.length - inserted
    await createAuditLog(db, {
      userId: user?.id ?? 'unknown',
      action: 'create',
      module: 'database',
      entityId: tableName,
      entityName: `Imported into ${tableName}`,
      changes: {
        action: 'import',
        tableName,
        count: inserted,
        existing,
        skipped: skipped.length,
      },
    })
    return c.json({
      success: true,
      count: inserted,
      existing,
      skipped: report,
      skippedTotal: skipped.length,
    })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

// GET /export/:tableName — returns every row in the table as JSON. The client
// converts to CSV; doing it here would force us to keep a per-column type map
// in sync with the schema. JSON serialisation is cheap and keeps this endpoint
// schema-agnostic. Admin-only — exports a flat copy of PII / financial data.
databaseApp.get('/export/:tableName', async (c) => {
  if (!(await checkAdmin(c))) return c.json({ error: 'Unauthorized' }, 403)
  const tableName = c.req.param('tableName')
  const table = TABLE_MAP[tableName]
  if (!table) return c.json({ error: 'Invalid table' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  const user = await getCurrentUser(c)
  try {
    const rows = await db.select().from(table)
    await createAuditLog(db, {
      userId: user?.id ?? 'unknown',
      action: 'view',
      module: 'database',
      entityId: tableName,
      entityName: `Exported ${tableName}`,
      changes: { action: 'export', tableName, count: rows.length },
    })
    // A backup file: keep the permanent file references so it re-imports later.
    c.set('keepPrivateRefs', true)
    return c.json({ success: true, data: rows, count: rows.length })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

// GET /template/:tableName — returns the header row only as a CSV template
// the operator can fill in before re-uploading via /import. The columns come
// from Drizzle's internal column map so they stay in sync with the schema.
databaseApp.get('/template/:tableName', async (c) => {
  if (!(await checkAdmin(c))) return c.json({ error: 'Unauthorized' }, 403)
  const tableName = c.req.param('tableName')
  const table = TABLE_MAP[tableName]
  if (!table) return c.json({ error: 'Invalid table' }, 400)
  // A template exists to be filled in and imported, so only the importable tables have one.
  if (!IMPORTABLE_TABLES[tableName]) return c.json(notImportable(tableName), 403)

  // Only the columns a file may carry: the others are set on their own screens (NOT_FROM_A_FILE).
  return c.json({ success: true, data: templateColumns(tableName).join(',') })
})

export { databaseApp }
