/**
 * Table import — which tables, how a CSV is read, and which rows are left out (F24 / D10).
 *
 * The admin "Database management" and "Data Inject" screens load a CSV into a table. The old path
 * split every line on every comma in the browser (a quoted value became several cells and its row
 * vanished), dropped any row whose cell count differed from the header's without telling anyone,
 * and let the server insert whatever columns arrived into any of 22 tables, including payments and
 * patients, where nothing writes the ledger entry, the patient number or the double-booking check.
 *
 * Now only the clinic's lookup tables can be imported; the server parses the CSV (quoting and line
 * breaks included), checks every row against the table's own columns, and returns the rows it did
 * not import with the reason. This file is pure: the route does the database work.
 */

import { parse } from 'csv-parse/browser/esm/sync'
import { getTableColumns } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import * as schema from '../db/schema'

/**
 * The lookup tables a CSV may be loaded into. Deliberately NOT here: payments, patients,
 * appointments, medical records and SMS (D10), anything the ledger or the stock ledger is built
 * from, and `payment_methods`, whose rows decide which ledger account a receipt posts to.
 */
export const IMPORTABLE_TABLES: Readonly<Record<string, PgTable>> = {
  appointment_types: schema.appointmentTypes,
  categories: schema.categories,
  expense_categories: schema.expenseCategories,
  payment_plan_templates: schema.paymentPlanTemplates,
  treatment_types: schema.treatmentTypes,
  units: schema.units,
}

/**
 * Columns a file may not carry, per table, with the reason shown to the person. Another screen owns
 * them, validates them and does the follow-on work, and a file would skip all of that. An expense
 * category's ledger account must be a real, non-control Expense account (PUT
 * /api/expenses/categories/:id/account checks it, then files the paid backlog under it), and its
 * petty-cash flag and reference type are kept in step by PATCH /api/expenses/categories/:id/petty.
 * Read from a file, the account could be any account (an expense would then post to the wrong
 * place) or none that exists (every expense in the category would fail to post).
 */
export const NOT_FROM_A_FILE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  expense_categories: {
    accountId:
      'the ledger account is chosen on the Expense categories screen, which checks that it is a real expense account',
    isPettyCash: 'the petty-cash flag is set on the Expense categories screen',
    pettyRefType: 'the petty-cash reference type is set on the Expense categories screen',
  },
}

/** The columns of a table that a file may carry, in the table's own order (the CSV template). */
export function templateColumns(tableName: string): string[] {
  const table = IMPORTABLE_TABLES[tableName]
  if (!table) return []
  const held = NOT_FROM_A_FILE[tableName] ?? {}
  return Object.keys(getTableColumns(table)).filter((key) => !Object.hasOwn(held, key))
}

export const MAX_IMPORT_ROWS = 5000

export type ImportRow = { row: number; cells: unknown[] }
export type SkippedRow = { row: number; reason: string }

export type ParsedCsv =
  | { ok: true; header: string[]; rows: ImportRow[] }
  | { ok: false; error: string }

/** Read CSV text into a header and numbered rows (the header is row 1, the first data row is 2). */
export function parseImportCsv(text: string): ParsedCsv {
  let records: string[][]
  try {
    records = parse(text, {
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
      bom: true,
    }) as string[][]
  } catch (err) {
    return {
      ok: false,
      error: `Could not read the CSV: ${err instanceof Error ? err.message : 'it is not valid CSV'}`,
    }
  }
  if (records.length < 2) {
    return {
      ok: false,
      error: 'The file has no rows to import: it needs a header line and at least one row.',
    }
  }
  const [header, ...data] = records
  if (data.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      error: `The file has ${data.length} rows; at most ${MAX_IMPORT_ROWS} can be imported at once.`,
    }
  }
  return { ok: true, header, rows: data.map((cells, i) => ({ row: i + 2, cells })) }
}

export type PreparedImport =
  | { ok: true; records: Record<string, unknown>[]; skipped: SkippedRow[] }
  | { ok: false; error: string }

const TRUE_WORDS = new Set(['true', '1', 'yes', 'y'])
const FALSE_WORDS = new Set(['false', '0', 'no', 'n'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isEmpty(raw: unknown): boolean {
  if (raw === undefined || raw === null) return true
  if (typeof raw === 'string') {
    const t = raw.trim()
    return t === '' || t.toLowerCase() === 'null'
  }
  return false
}

type Coerced = { ok: true; value: unknown } | { ok: false; reason: string }

/** One cell, read as the column's own type. `key` is the property name the person sees. */
function coerce(key: string, column: PgColumn, raw: unknown): Coerced {
  const type = column.columnType
  const text = typeof raw === 'string' ? raw.trim() : raw
  const bad = (what: string) => ({
    ok: false as const,
    reason: `"${key}" must be ${what} (got "${String(raw)}").`,
  })

  if (type === 'PgBoolean') {
    if (typeof text === 'boolean') return { ok: true, value: text }
    const word = String(text).toLowerCase()
    if (TRUE_WORDS.has(word)) return { ok: true, value: true }
    if (FALSE_WORDS.has(word)) return { ok: true, value: false }
    return bad('true or false')
  }
  if (/^Pg(Integer|SmallInt|BigInt53|Serial|SmallSerial)$/.test(type)) {
    const n = typeof text === 'number' ? text : /^-?\d+$/.test(String(text)) ? Number(text) : NaN
    return Number.isSafeInteger(n) ? { ok: true, value: n } : bad('a whole number')
  }
  if (/^Pg(Numeric|DoublePrecision|Real)/.test(type)) {
    const n =
      typeof text === 'number' ? text : /^-?\d+(\.\d+)?$/.test(String(text)) ? Number(text) : NaN
    return Number.isFinite(n) ? { ok: true, value: n } : bad('a number')
  }
  if (type === 'PgUUID') {
    return UUID.test(String(text)) ? { ok: true, value: String(text) } : bad('a valid id')
  }
  if (type === 'PgTimestamp') {
    const d = text instanceof Date ? text : new Date(String(text))
    return Number.isNaN(d.getTime()) ? bad('a valid date') : { ok: true, value: d }
  }
  if (type === 'PgDateString' || type === 'PgDate') {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(text))
      ? { ok: true, value: String(text) }
      : bad('a date written YYYY-MM-DD')
  }
  if (type === 'PgJsonb' || type === 'PgJson') {
    if (typeof text !== 'string') return { ok: true, value: text }
    try {
      return { ok: true, value: JSON.parse(text) }
    } catch {
      return bad('valid JSON')
    }
  }
  // text, varchar and anything else: keep exactly what was written
  return { ok: true, value: typeof raw === 'string' ? raw.trim() : String(raw) }
}

/**
 * Check a parsed file against a table and produce records ready to insert. Header problems refuse
 * the whole file (nothing sensible can be done with it); a bad row is left out and reported, and
 * the rest are kept.
 */
export function prepareImport(
  table: PgTable,
  header: string[],
  rows: ImportRow[],
  notFromFile: Readonly<Record<string, string>> = {}
): PreparedImport {
  const columns = getTableColumns(table)

  if (header.some((h) => h.trim() === '')) {
    return { ok: false, error: 'The header has an empty column name.' }
  }
  const seen = new Set<string>()
  for (const h of header) {
    if (seen.has(h)) return { ok: false, error: `Column "${h}" appears more than once.` }
    seen.add(h)
  }
  // Own properties only: `'constructor' in columns` is true for any plain object.
  const unknown = header.filter((h) => !Object.hasOwn(columns, h))
  if (unknown.length) {
    return {
      ok: false,
      error: `Unknown column${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. Download the template to see the columns this table accepts.`,
    }
  }
  const held = header.filter((h) => Object.hasOwn(notFromFile, h))
  if (held.length) {
    return {
      ok: false,
      error: `${held.length > 1 ? 'These columns' : 'This column'} cannot be imported: ${held
        .map((h) => `${h} (${notFromFile[h]})`)
        .join('; ')}. Take ${held.length > 1 ? 'them' : 'it'} out of the file.`,
    }
  }
  const required = Object.entries(columns)
    .filter(([, c]) => c.notNull && !c.hasDefault && !c.generated)
    .map(([key]) => key)
  const missing = required.filter((key) => !seen.has(key))
  if (missing.length) {
    return {
      ok: false,
      error: `The file needs ${missing.length > 1 ? 'these columns' : 'this column'}: ${missing.join(', ')}.`,
    }
  }

  const records: Record<string, unknown>[] = []
  const skipped: SkippedRow[] = []
  for (const { row, cells } of rows) {
    if (cells.length !== header.length) {
      skipped.push({
        row,
        reason: `The row has ${cells.length} value${cells.length === 1 ? '' : 's'} but the header has ${header.length} columns.`,
      })
      continue
    }
    const record: Record<string, unknown> = {}
    let reason: string | null = null
    for (let i = 0; i < header.length && !reason; i++) {
      const key = header[i]
      const column = columns[key]
      const raw = cells[i]
      if (isEmpty(raw)) {
        if (column.notNull && !column.hasDefault && !column.generated) {
          reason = `"${key}" is required.`
        } else if (!column.notNull) {
          record[key] = null
        } // else: a default applies, so the key is left out
        continue
      }
      const result = coerce(key, column, raw)
      if (!result.ok) reason = result.reason
      else record[key] = result.value
    }
    if (reason) skipped.push({ row, reason })
    else records.push(record)
  }
  return { ok: true, records, skipped }
}

/** Rows that arrive as JSON objects (an older client, a script) go through the same checks. */
export function rowsFromRecords(records: Array<Record<string, unknown>>): {
  header: string[]
  rows: ImportRow[]
} {
  const header = [...new Set(records.flatMap((r) => Object.keys(r)))]
  return {
    header,
    rows: records.map((r, i) => ({ row: i + 2, cells: header.map((h) => r[h]) })),
  }
}
