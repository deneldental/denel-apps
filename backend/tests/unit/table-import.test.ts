/**
 * F24 / D10 — what a table import accepts, and what it says about the rows it leaves out. See
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.12).
 *
 * The Settings database section and the Data Inject page parsed the CSV in the browser by splitting
 * every line on every comma, so a quoted value such as "Crown, porcelain" became two cells and its
 * row vanished; any row whose cell count differed from the header's was skipped without a word; and
 * the server inserted whatever columns the browser sent into any of 22 tables, including payments
 * and patients, with no ledger entry, no patient number and no double-booking check.
 *
 * Now the server parses the CSV (quoting and embedded line breaks included), checks every row
 * against the table's own columns, and returns exactly which rows it did not import and why. Which
 * tables may be imported at all is decided by `IMPORTABLE_TABLES`.
 */
import { getTableColumns } from 'drizzle-orm'
import {
  date,
  doublePrecision,
  integer,
  jsonb,
  numeric,
  type PgTable,
  pgTable,
  serial,
} from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import * as schema from '../../src/db/schema'
import {
  IMPORTABLE_TABLES,
  MAX_IMPORT_ROWS,
  NOT_FROM_A_FILE,
  parseImportCsv,
  prepareImport,
  rowsFromRecords,
  templateColumns,
} from '../../src/lib/table-import'

const types = schema.treatmentTypes
const prepare = (csv: string, table: PgTable = types) => {
  const parsed = parseImportCsv(csv)
  if (!parsed.ok) return parsed
  return prepareImport(table, parsed.header, parsed.rows)
}

describe('which tables may be imported (D10)', () => {
  it('only the lookup tables, none of the clinical or financial ones', () => {
    expect(Object.keys(IMPORTABLE_TABLES).sort()).toEqual([
      'appointment_types',
      'categories',
      'expense_categories',
      'payment_plan_templates',
      'treatment_types',
      'units',
    ])
  })

  it.each([
    'payments',
    'patients',
    'appointments',
    'medical_records',
    'pending_medical_records',
    'sms_messages',
    'payment_methods',
    'payment_plans',
    'expenses',
    'sales',
    'items',
    'doctors',
    'daily_reports',
    'ortho_consent_forms',
    'messages',
    'doctor_unavailability',
  ])('does not list %s', (name) => {
    expect(name in IMPORTABLE_TABLES).toBe(false)
  })
})

describe('parseImportCsv', () => {
  it('keeps a quoted value with a comma in one cell', () => {
    const r = parseImportCsv('name,displayName\n"Crown, porcelain",Crown\n')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.rows[0].cells).toEqual(['Crown, porcelain', 'Crown'])
  })

  it('keeps a quoted value with a line break and an escaped quote', () => {
    const r = parseImportCsv('name,displayName\n"Line one\nline two","say ""hi"""\n')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.rows[0].cells).toEqual(['Line one\nline two', 'say "hi"'])
  })

  it('copes with a BOM, Windows line endings, blank lines and spaces around values', () => {
    const r = parseImportCsv('﻿name , displayName\r\n\r\n  Scaling , Scale \r\n')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.header).toEqual(['name', 'displayName'])
      expect(r.rows.map((x) => x.cells)).toEqual([['Scaling', 'Scale']])
    }
  })

  it('numbers data rows from 2, as the file shows them (the header is row 1)', () => {
    const r = parseImportCsv('name\nA\nB\nC\n')
    expect(r.ok && r.rows.map((x) => x.row)).toEqual([2, 3, 4])
  })

  it('says so when there is nothing to import', () => {
    expect(parseImportCsv('').ok).toBe(false)
    expect(parseImportCsv('name,displayName\n').ok).toBe(false)
  })

  it('refuses a file with an unterminated quote instead of guessing', () => {
    const r = parseImportCsv('name\n"never closed\n')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/CSV/i)
  })

  it('allows exactly 5000 rows and refuses 5001', () => {
    const rows = (n: number) => `name\n${Array.from({ length: n }, (_, i) => `n${i}`).join('\n')}\n`
    expect(MAX_IMPORT_ROWS).toBe(5000)
    expect(parseImportCsv(rows(5000)).ok).toBe(true)
    const over = parseImportCsv(rows(5001))
    expect(over.ok).toBe(false)
    if (!over.ok) expect(over.error).toMatch(/5000/)
  })

  it('refuses a file with more rows than the limit', () => {
    const csv = `name\n${Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `n${i}`).join('\n')}\n`
    const r = parseImportCsv(csv)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(String(MAX_IMPORT_ROWS))
  })
})

describe('prepareImport — the header', () => {
  it('refuses a column the table does not have, and names it', () => {
    const r = prepare('name,nonsense\nA,1\n')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/nonsense/)
  })

  it('refuses an empty or repeated column name', () => {
    expect(prepare('name,\nA,1\n').ok).toBe(false)
    const dup = prepare('name,name\nA,B\n')
    expect(dup.ok).toBe(false)
    if (!dup.ok) expect(dup.error).toMatch(/more than once/i)
  })

  it('says an empty column name is empty, rather than calling it an unknown column', () => {
    const r = prepare('name,\nA,1\n')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/empty column name/i)
  })

  it.each([
    'constructor',
    'toString',
    '__proto__',
    'hasOwnProperty',
  ])('does not mistake the object property %s for a column', (name) => {
    const parsed = parseImportCsv(`name,${name}
A,1
`)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const r = prepareImport(types, parsed.header, parsed.rows)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Unknown column/)
  })

  it('refuses a file that leaves out a column the table cannot do without', () => {
    const r = prepare('displayName\nCrown\n')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/name/)
  })
})

describe('prepareImport — rows', () => {
  it('reads a clean file into records, typed by the table’s columns', () => {
    const r = prepare(
      'name,displayName,isActive,autoSyncEnabled,defaultRecareMonths,adaGroup\n' +
        'Scaling,Scaling & polish,true,no,6,Preventive\n'
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.skipped).toEqual([])
      expect(r.records).toEqual([
        {
          name: 'Scaling',
          displayName: 'Scaling & polish',
          isActive: true,
          autoSyncEnabled: false,
          defaultRecareMonths: 6,
          adaGroup: 'Preventive',
        },
      ])
    }
  })

  it('reports a row whose cell count differs from the header, and imports the rest', () => {
    const r = prepare('name,displayName\nA,Alpha\nB\nC,Gamma,extra\nD,Delta\n')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.records.map((x) => x.name)).toEqual(['A', 'D'])
      expect(r.skipped).toEqual([
        { row: 3, reason: expect.stringMatching(/1 value.*2 columns/i) },
        { row: 4, reason: expect.stringMatching(/3 values.*2 columns/i) },
      ])
    }
  })

  it('reports a missing required value', () => {
    const r = prepare('name,displayName\n,Alpha\nB,Beta\n')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.records.map((x) => x.name)).toEqual(['B'])
      expect(r.skipped).toEqual([{ row: 2, reason: expect.stringMatching(/name.*required/i) }])
    }
  })

  it('turns an empty cell or the word null into null for an optional column', () => {
    const r = prepare('name,displayName,defaultRecareMonths\nA,,\nB,NULL,null\n')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.records[0]).toMatchObject({
        name: 'A',
        displayName: null,
        defaultRecareMonths: null,
      })
      expect(r.records[1]).toMatchObject({
        name: 'B',
        displayName: null,
        defaultRecareMonths: null,
      })
    }
  })

  it('leaves out an empty cell for a column that has a default, so the default applies', () => {
    const r = prepare('name,isActive\nA,\n')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.records[0]).toEqual({ name: 'A' })
  })

  it.each([
    ['true', true],
    ['TRUE', true],
    ['1', true],
    ['yes', true],
    ['false', false],
    ['0', false],
    ['No', false],
  ])('reads %s as a boolean', (cell, expected) => {
    const r = prepare(`name,isActive\nA,${cell}\n`)
    expect(r.ok && r.records[0].isActive).toBe(expected)
  })

  it('reports a value that is not a boolean, a whole number, or a date', () => {
    const r = prepare(
      'name,isActive,defaultRecareMonths,createdAt\n' +
        'A,maybe,3,\n' +
        'B,true,3.5,\n' +
        'C,true,"1,200",\n' +
        'D,true,3,not a date\n' +
        'E,true,3,2026-10-26T09:00:00Z\n'
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.records.map((x) => x.name)).toEqual(['E'])
      expect(r.skipped.map((s) => s.row)).toEqual([2, 3, 4, 5])
      expect(r.skipped[0].reason).toMatch(/isActive/)
      expect(r.skipped[1].reason).toMatch(/defaultRecareMonths/)
      expect(r.skipped[3].reason).toMatch(/createdAt/)
    }
  })

  it('reports an id that is not a UUID', () => {
    const r = prepare('id,name\nnot-a-uuid,A\n3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d,B\n')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.records.map((x) => x.name)).toEqual(['B'])
      expect(r.skipped).toEqual([{ row: 2, reason: expect.stringMatching(/id/) }])
    }
  })

  it('says when every row was left out', () => {
    const r = prepare('name,displayName\nA\nB\n')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.records).toEqual([])
      expect(r.skipped).toHaveLength(2)
    }
  })

  it('works for the other lookup tables too', () => {
    const r = prepare('name,colour\n"Check-up, routine",#112233\n', schema.appointmentTypes)
    expect(r.ok && r.records).toEqual([{ name: 'Check-up, routine', colour: '#112233' }])
    const u = prepare('name\nbox\n', schema.units)
    expect(u.ok && u.records).toEqual([{ name: 'box' }])
  })
})

describe('prepareImport — whole numbers are written as digits, nothing cleverer', () => {
  it.each(['1e3', '0x10', '0b11', '1_000', '+5', '3.0', '١٢'])('reports %j', (cell) => {
    const r = prepare(`name,defaultRecareMonths\nA,${cell}\n`)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.records).toEqual([])
      expect(r.skipped[0].reason).toMatch(/defaultRecareMonths/)
    }
  })

  it.each([
    ['7', 7],
    ['-2', -2],
    ['  12  ', 12],
    ['0', 0],
  ])('reads %j as %i', (cell, expected) => {
    const r = prepare(`name,defaultRecareMonths\nA,${cell}\n`)
    expect(r.ok && r.records[0].defaultRecareMonths).toBe(expected)
  })
})

describe('prepareImport — column types the six lookup tables do not use today', () => {
  // A table of our own, so every branch of the cell reader is pinned even though the importable
  // tables only have text, boolean, integer, timestamp and uuid columns.
  const sample = pgTable('sample', {
    id: serial('id').primaryKey(),
    when: date('when', { mode: 'string' }),
    amount: numeric('amount'),
    ratio: doublePrecision('ratio'),
    extra: jsonb('extra'),
    count: integer('count'),
  })

  it('reads a date only when it is written YYYY-MM-DD', () => {
    const r = prepare(
      'when\n2026-10-26\n26/10/2026\n2026-1-5\n2026-10-26T09:00:00Z\ntomorrow\n',
      sample
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.records).toEqual([{ when: '2026-10-26' }])
      expect(r.skipped.map((s) => s.row)).toEqual([3, 4, 5, 6])
      expect(r.skipped[0].reason).toMatch(/YYYY-MM-DD/)
    }
  })

  it('reads numbers, and nothing that merely converts to one', () => {
    const r = prepare('amount,ratio\n12.50,0.5\n1e3,2\nabc,1\n,\n-4,-1.25\n', sample)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.records).toEqual([
        { amount: 12.5, ratio: 0.5 },
        { amount: null, ratio: null },
        { amount: -4, ratio: -1.25 },
      ])
      expect(r.skipped.map((s) => s.row)).toEqual([3, 4])
    }
  })

  it('reads JSON and refuses text that is not JSON', () => {
    const r = prepare('extra\n"{""a"":1}"\n{bad\n', sample)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.records).toEqual([{ extra: { a: 1 } }])
      expect(r.skipped).toEqual([{ row: 3, reason: expect.stringMatching(/valid JSON/) }])
    }
  })

  it('leaves a serial id to the database', () => {
    const r = prepare('count\n5\n', sample)
    expect(r.ok && r.records).toEqual([{ count: 5 }])
  })
})

describe('rowsFromRecords — rows that arrive as JSON objects', () => {
  it('numbers them from 2, like a file with a header, and uses every key that appears', () => {
    const { header, rows } = rowsFromRecords([{ name: 'A' }, { name: 'B', displayName: 'Bee' }])
    expect(header).toEqual(['name', 'displayName'])
    expect(rows).toEqual([
      { row: 2, cells: ['A', undefined] },
      { row: 3, cells: ['B', 'Bee'] },
    ])
  })

  it('goes through the same checks as a file', () => {
    const { header, rows } = rowsFromRecords([{ name: 'A', isActive: 'maybe' }, { name: 'B' }])
    const r = prepareImport(types, header, rows)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.records.map((x) => x.name)).toEqual(['B'])
      expect(r.skipped).toEqual([{ row: 2, reason: expect.stringMatching(/isActive/) }])
    }
  })
})

describe('columns a file may not carry (the screens that own them check them)', () => {
  // The Expense categories screen validates all three: the ledger account must be a real,
  // non-control Expense account (PUT /api/expenses/categories/:id/account, which also files the
  // paid backlog), and the petty-cash flag and reference type are kept in step by
  // PATCH /api/expenses/categories/:id/petty. A file that carried them would skip every check.
  const prepareFor = (tableName: string, csv: string) => {
    const parsed = parseImportCsv(csv)
    if (!parsed.ok) return parsed
    return prepareImport(
      IMPORTABLE_TABLES[tableName],
      parsed.header,
      parsed.rows,
      NOT_FROM_A_FILE[tableName]
    )
  }

  it('names the columns of an expense category that only its own screen may set', () => {
    expect(Object.keys(NOT_FROM_A_FILE.expense_categories).sort()).toEqual([
      'accountId',
      'isPettyCash',
      'pettyRefType',
    ])
  })

  it.each([
    'accountId',
    'isPettyCash',
    'pettyRefType',
  ])('refuses an expense-category file with a %s column, and says why', (column) => {
    const r = prepareFor('expense_categories', `name,${column}\nFuel,x\n`)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain(column)
      expect(r.error).toMatch(/cannot be imported/i)
      expect(r.error).toMatch(/Expense categories screen/)
    }
  })

  it('says the ledger account must be a real expense account', () => {
    const r = prepareFor(
      'expense_categories',
      'name,accountId\nFuel,3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d\n'
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/expense account/i)
  })

  it('names every such column the file carries, not only the first', () => {
    const r = prepareFor('expense_categories', 'name,accountId,isPettyCash\nFuel,,true\n')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('accountId')
      expect(r.error).toContain('isPettyCash')
    }
  })

  it('accepts the same file without them', () => {
    const r = prepareFor('expense_categories', 'name,displayName,isActive\nFuel,Fuel,true\n')
    expect(r.ok && r.records).toEqual([{ name: 'Fuel', displayName: 'Fuel', isActive: true }])
  })

  it('does not hold back anything for the other tables', () => {
    for (const name of Object.keys(IMPORTABLE_TABLES)) {
      if (name !== 'expense_categories') expect(NOT_FROM_A_FILE[name]).toBeUndefined()
    }
    const r = prepareFor('units', 'name,isActive\nbox,true\n')
    expect(r.ok && r.records).toEqual([{ name: 'box', isActive: true }])
  })

  it('only lists importable tables and real columns (a typo would hold nothing back)', () => {
    for (const [tableName, columns] of Object.entries(NOT_FROM_A_FILE)) {
      expect(IMPORTABLE_TABLES[tableName], tableName).toBeDefined()
      const real = Object.keys(getTableColumns(IMPORTABLE_TABLES[tableName]))
      for (const column of Object.keys(columns))
        expect(real, `${tableName}.${column}`).toContain(column)
    }
  })

  it('leaves them out of the template too, so the template is a file that can be imported', () => {
    const columns = templateColumns('expense_categories')
    expect(columns).toContain('name')
    expect(columns).toContain('isActive')
    for (const held of ['accountId', 'isPettyCash', 'pettyRefType']) {
      expect(columns).not.toContain(held)
    }
  })

  it('gives every other table all of its columns, in the table’s own order', () => {
    for (const [name, table] of Object.entries(IMPORTABLE_TABLES)) {
      if (name === 'expense_categories') continue
      expect(templateColumns(name), name).toEqual(Object.keys(getTableColumns(table)))
    }
  })

  it('is the header of a file that is not refused for its header', () => {
    for (const [name, table] of Object.entries(IMPORTABLE_TABLES)) {
      // no rows: only the header is judged
      const r = prepareImport(table, templateColumns(name), [], NOT_FROM_A_FILE[name])
      expect(r.ok, name).toBe(true)
    }
  })
})
