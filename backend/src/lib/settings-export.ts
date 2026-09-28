import { getTableColumns } from 'drizzle-orm'
import type { DB } from '../db'
import * as schema from '../db/schema'

/**
 * Integration secrets never travel (settings-domain-audit A5): every
 * `integration_*` key except the branding paths, and every `integrations:*`
 * key (Google OAuth config, service account, per-user contact tokens). By
 * prefix, so a provider added tomorrow is excluded too. Applied on export AND
 * on import — an import must never overwrite this instance's live tokens.
 */
export function isExportableSettingKey(key: string): boolean {
  if (key === 'integration_branding') return true
  return !(key.startsWith('integration_') || key.startsWith('integrations:'))
}

/**
 * Lookup tables carried by a settings export. Single source of truth — export,
 * import and the progress denominator all read this, so the three can no longer
 * drift apart. Rows travel with their ids and upsert on id; a row whose natural
 * key already exists under another id is reported, not silently dropped.
 * Deliberately absent: appointment-type reminder stages (id references that
 * differ across environments) and tax configurations (payroll-critical, own
 * admin page) — settings-domain-audit D2.
 */
export const IMPORTABLE_TABLES = [
  'appointmentTypes',
  'documentTags',
  'staffDocumentTypes',
  'staffTitles',
  'employmentTypes',
  'hrDepartments',
  'requestKinds',
  'requestSubtypes',
  'inventoryLocations',
  'complianceCategories',
  'consentTemplates',
  'specialties',
  'examinationTypes',
  'treatmentTypes',
  'xrayTypes',
  'presentingComplaints',
  'pastMedicalHistory',
  'drugHistoryItems',
  'allergies',
  'socialHistoryItems',
  'dentalReviewItems',
  'orthoTreatments',
  'drugFrequencies',
  'expenseCategories',
  'paymentMethods',
  'units',
  // settings-domain-audit D2 (S6)
  'categories',
  'labCaseStatuses',
  'complianceTags',
  'patientTags',
  'reminderTemplates',
  'clinicHolidays',
] as const

export async function exportSettings(db: any) {
  // 1. Fetch KV clinic settings
  const clinicSettingsData = await db.select().from(schema.clinicSettings)

  const filteredClinicSettings = clinicSettingsData.filter((row: any) =>
    isExportableSettingKey(String(row.key))
  )

  // 2. Fetch lookup tables
  const data: Record<string, any> = {
    clinicSettings: filteredClinicSettings,
  }

  const lookupTables = IMPORTABLE_TABLES

  for (const tableName of lookupTables) {
    if (schema[tableName as keyof typeof schema]) {
      const tableData = await db.select().from(schema[tableName as keyof typeof schema])
      data[tableName] = tableData
    }
  }

  return data
}

/**
 * JSON has no Date type, so every timestamp in an exported settings file comes
 * back as an ISO string. Drizzle's `timestamp()` columns call `.toISOString()`
 * on whatever they are handed, so a raw string throws
 * `value.toISOString is not a function` and the whole import 500s.
 *
 * Driven by the schema rather than a hardcoded field list: `dataType === 'date'`
 * matches PgTimestamp columns exactly, and deliberately does NOT match
 * `date()` columns declared in string mode (PgDateString, dataType 'string'),
 * which Postgres wants as 'YYYY-MM-DD' text.
 *
 * Unknown keys are dropped — an edited or foreign export must not inject columns
 * the table does not have.
 */
function coerceRowForTable(tableSchema: any, row: Record<string, any>): Record<string, any> {
  const columns = getTableColumns(tableSchema) as Record<string, any>
  const out: Record<string, any> = {}
  for (const [key, value] of Object.entries(row)) {
    const column = columns[key]
    if (!column) continue
    if (column.dataType === 'date' && value != null && !(value instanceof Date)) {
      const parsed = new Date(value as string | number)
      if (Number.isNaN(parsed.getTime())) {
        throw new Error(`Invalid date for "${key}": ${JSON.stringify(value)}`)
      }
      out[key] = parsed
      continue
    }
    out[key] = value
  }
  return out
}

export interface ImportSettingsResult {
  imported: number
  /** Rows that could not be imported, with the reason. Never silently dropped. */
  failures: Array<{ table: string; row: string; error: string }>
}

/**
 * Progress reporter. Called after each row so a caller can stream a real
 * percentage; `label` names the table currently being written.
 */
export type ImportProgress = (done: number, total: number, label: string) => void

/** What `db.transaction` hands its callback — here, a savepoint. */
type Tx = Parameters<Parameters<DB['transaction']>[0]>[0]

/** Total rows an import payload will attempt, for progress denominators. */
export function countImportRows(data: Record<string, any>): number {
  let total = Array.isArray(data.clinicSettings) ? data.clinicSettings.length : 0
  for (const tableName of IMPORTABLE_TABLES) {
    if (Array.isArray(data[tableName])) total += data[tableName].length
  }
  return total
}

export async function importSettings(
  db: any,
  data: Record<string, any>,
  importedById: string,
  onProgress?: ImportProgress
): Promise<ImportSettingsResult> {
  const failures: ImportSettingsResult['failures'] = []
  let imported = 0
  const total = countImportRows(data)
  // Counts every row ATTEMPTED, unlike `imported` which counts successes — the
  // bar must still reach 100% when some rows fail.
  let processed = 0

  await db.transaction(async (tx: any) => {
    // Every row is written inside its own SAVEPOINT (`tx.transaction` nests as
    // one). Catching a failed statement inside a Postgres transaction does not
    // un-fail the transaction: without the savepoint every later statement
    // answers 25P02 and the final COMMIT is silently a ROLLBACK — so a caught
    // failure used to be reported as "imported: N" for rows the database then
    // threw away. Now one bad row costs exactly that row.
    const attempt = async (
      table: string,
      label: string,
      write: (sp: Tx) => Promise<void>
    ): Promise<void> => {
      try {
        await tx.transaction(write)
        imported++
      } catch (err) {
        failures.push({
          table,
          row: label,
          error: err instanceof Error ? err.message : String(err),
        })
      }
      processed++
      onProgress?.(processed, total, table)
    }

    // 1. Upsert clinic settings. `updatedById` is an FK to `user.id`, and the
    // file's value is an id from wherever the export was made — a restore onto
    // a fresh instance, or a since-deleted user, and one such row aborted the
    // whole import. The importer is the one writing, so the importer is what
    // the row records, and `updatedAt` is now.
    if (Array.isArray(data.clinicSettings)) {
      const now = new Date()
      for (const row of data.clinicSettings) {
        const key = typeof row?.key === 'string' ? row.key.trim() : ''
        if (!key || row.value === undefined) {
          failures.push({
            table: 'clinicSettings',
            row: key || '(no key)',
            error: 'row needs a key and a value',
          })
          processed++
          onProgress?.(processed, total, 'clinicSettings')
          continue
        }
        if (!isExportableSettingKey(key)) {
          failures.push({
            table: 'clinicSettings',
            row: key,
            error:
              'integration keys are never imported — configure the integration on this instance',
          })
          processed++
          onProgress?.(processed, total, 'clinicSettings')
          continue
        }
        const stamped = { value: row.value, updatedById: importedById, updatedAt: now }
        await attempt('clinicSettings', key, async (sp) => {
          await sp
            .insert(schema.clinicSettings)
            .values({ key, ...stamped })
            .onConflictDoUpdate({ target: schema.clinicSettings.key, set: stamped })
        })
      }
    }

    // 2. Upsert lookup tables
    for (const tableName of IMPORTABLE_TABLES) {
      if (!Array.isArray(data[tableName]) || !schema[tableName as keyof typeof schema]) continue
      const tableSchema = schema[tableName as keyof typeof schema] as any

      for (const row of data[tableName]) {
        // Determine the primary key field. Many lookups use 'id', some use 'name' or 'entity'.
        let pkField = tableSchema.id
        if (!pkField && tableSchema.name && tableSchema.name.primary) {
          pkField = tableSchema.name
        }
        if (!pkField && tableSchema.entity && tableSchema.entity.primary) {
          pkField = tableSchema.entity
        }

        if (!pkField) {
          // Most tables have an 'id' or 'name' primary key
          continue
        }

        // Coerce EVERY date column, not just createdAt/updatedAt — a lookup
        // carrying any other timestamp would have thrown the same way.
        let insertData: Record<string, any>
        try {
          insertData = coerceRowForTable(tableSchema, row)
        } catch (err) {
          failures.push({
            table: tableName,
            row: String(row?.id ?? row?.name ?? '(unknown)'),
            error: err instanceof Error ? err.message : String(err),
          })
          processed++
          onProgress?.(processed, total, tableName)
          continue
        }

        // We'll prepare an object for `set` on conflict
        const setFields = { ...insertData }
        // Remove the primary key from the set payload so we don't try to update it
        delete setFields[pkField.name]

        if (Object.keys(setFields).length === 0) {
          continue
        }

        await attempt(tableName, String(row?.id ?? row?.name ?? '(unknown)'), async (sp) => {
          await sp.insert(tableSchema).values(insertData).onConflictDoUpdate({
            target: pkField,
            set: setFields,
          })
        })
      }
    }
  })

  return { imported, failures }
}
