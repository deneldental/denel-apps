import type { PgTable } from 'drizzle-orm/pg-core'
import { type Context, Hono } from 'hono'
import { getDb } from '../db'
import * as schema from '../db/schema'
import { createAuditLog } from '../lib/audit'
import { getCurrentUser, isAdminUser } from '../lib/rbac'
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

    for (const table of tables) {
      await db.delete(table)
    }
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

databaseApp.post('/import/:tableName', async (c) => {
  if (!(await checkAdmin(c))) return c.json({ error: 'Unauthorized' }, 403)
  const tableName = c.req.param('tableName')
  const records = await c.req.json()
  const table = TABLE_MAP[tableName]
  if (!table) return c.json({ error: 'Invalid table' }, 400)
  if (!Array.isArray(records) || records.length === 0) {
    return c.json({ error: 'Empty payload' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const user = await getCurrentUser(c)
  try {
    await db.insert(table).values(records)
    await createAuditLog(db, {
      userId: user?.id ?? 'unknown',
      action: 'create',
      module: 'database',
      entityId: tableName,
      entityName: `Imported into ${tableName}`,
      changes: { action: 'import', tableName, count: records.length },
    })
    return c.json({ success: true, count: records.length })
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

  // Drizzle stores the column map under a private symbol; pull it via the
  // documented `getTableConfig`-equivalent: walk the table's own enumerable
  // properties for PgColumn instances.
  const columnNames: string[] = []
  for (const [key, value] of Object.entries(table)) {
    if (value && typeof value === 'object' && 'name' in value && 'columnType' in value) {
      columnNames.push(key)
    }
  }

  return c.json({ success: true, data: columnNames.join(',') })
})

export { databaseApp }
