/**
 * F24 / D10 — the admin table import, on the real stack. See
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.12).
 *
 * Before: any of 22 tables could be loaded from the browser's own CSV parsing, which split on every
 * comma, silently dropped any row with a different cell count, and sent whatever columns it found.
 * Imported payments had no journal entry, imported patients no patient number, imported appointments
 * no double-booking check.
 *
 * Now: only the lookup tables are importable; the server parses the CSV, checks every row against
 * the table, and returns the rows it left out with the reason. Every refusal below is the real
 * admin check and the real table rule speaking.
 *
 * ── Safety ── commits rows in `treatment_types`, `units` and `expense_categories` named
 * `IT import …` and removes them in afterAll; local Postgres only. It never calls clear-table or
 * clear-all.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/database-import.test.ts
 */
import { and, count, desc, eq, ilike, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/sms', () => ({
  sendSMS: vi.fn(async () => ({ success: true })),
  getHubtelCredentials: vi.fn(async () => null),
}))

import type { DB } from '../../src/db'
import {
  auditLogs,
  expenseCategories,
  patients,
  payments,
  treatmentTypes,
  units,
} from '../../src/db/schema'
import {
  callAs,
  createLoginUser,
  deleteLoginUsers,
  hasBackendSecrets,
  isLocalDb,
  localDb,
  signInAs,
  type TestApp,
} from './_session'

const skip = !(isLocalDb && hasBackendSecrets)
const APP_BOOT_TIMEOUT_MS = 180_000
const db = localDb() as DB

const TAG = `IT import ${Date.now()}`
let app: TestApp
let adminCookie = ''
let adminUserId = ''
let recepCookie = ''
const userIds: string[] = []

const as = (cookie: string, method: string, path: string, body?: unknown) =>
  callAs(app, 'portal', cookie, method, path, body)
const admin = (method: string, path: string, body?: unknown) => as(adminCookie, method, path, body)

const named = (table: typeof treatmentTypes | typeof units | typeof expenseCategories) =>
  db
    .select({ name: table.name })
    .from(table)
    .where(ilike(table.name, `${TAG}%`))

describe.skipIf(skip)('/api/database import (F24)', () => {
  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { validateBackendEnv } = await import('../../src/config/env')
    validateBackendEnv()
    app = (await import('../../src/app')).app as unknown as TestApp

    const adminEmail = `admin-${Date.now()}@dbimport.test`
    const recepEmail = `recep-${Date.now()}@dbimport.test`
    const adminId = await createLoginUser(db, {
      email: adminEmail,
      name: 'DbImport admin',
      roleId: 'admin',
      baRole: 'admin',
    })
    const recepId = await createLoginUser(db, {
      email: recepEmail,
      name: 'DbImport recep',
      roleId: 'receptionist',
    })
    userIds.push(adminId, recepId)
    adminUserId = adminId
    adminCookie = await signInAs(app, adminEmail, 'portal')
    recepCookie = await signInAs(app, recepEmail, 'portal')
  }, APP_BOOT_TIMEOUT_MS)

  afterAll(async () => {
    await db.delete(treatmentTypes).where(ilike(treatmentTypes.name, `${TAG}%`))
    await db.delete(units).where(ilike(units.name, `${TAG}%`))
    await db.delete(expenseCategories).where(ilike(expenseCategories.name, `${TAG}%`))
    await deleteLoginUsers(db, userIds)
  })

  describe('who and what', () => {
    it('refuses anyone who is not an administrator, for every database endpoint', async () => {
      const csv = `name\n${TAG} nope\n`
      for (const [method, path, body] of [
        ['GET', '/api/database/importable-tables', undefined],
        ['GET', '/api/database/template/treatment_types', undefined],
        ['POST', '/api/database/import/treatment_types', { csv }],
      ] as const) {
        const res = await as(recepCookie, method, path, body)
        expect(res.status, `${method} ${path}`).toBe(403)
      }
      expect(await named(treatmentTypes)).toEqual([])
    })

    it('lists the importable tables, which are the lookup tables only', async () => {
      const res = await admin('GET', '/api/database/importable-tables')
      expect(res.status).toBe(200)
      expect(res.json?.data).toEqual([
        'appointment_types',
        'categories',
        'expense_categories',
        'payment_plan_templates',
        'treatment_types',
        'units',
      ])
    })

    it('still lists every table for export and clearing', async () => {
      const res = await admin('GET', '/api/database/tables')
      expect(res.status).toBe(200)
      const tables = res.json?.data as string[]
      expect(tables).toContain('patients')
      expect(tables).toContain('payments')
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
    ])('refuses to import into %s, and writes nothing', async (table) => {
      const [{ n: patientsBefore }] = await db.select({ n: count() }).from(patients)
      const [{ n: paymentsBefore }] = await db.select({ n: count() }).from(payments)
      const res = await admin('POST', `/api/database/import/${table}`, {
        csv: 'id,name\n3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d,x\n',
      })
      expect(res.status, JSON.stringify(res.json)).toBe(403)
      expect(res.json?.code).toBe('IMPORT_TABLE_NOT_ALLOWED')
      const [{ n: patientsAfter }] = await db.select({ n: count() }).from(patients)
      const [{ n: paymentsAfter }] = await db.select({ n: count() }).from(payments)
      expect(patientsAfter).toBe(patientsBefore)
      expect(paymentsAfter).toBe(paymentsBefore)
    })

    it('answers 400 for a table that does not exist', async () => {
      const res = await admin('POST', '/api/database/import/not_a_table', { csv: 'name\nx\n' })
      expect(res.status).toBe(400)
    })

    it('gives a template only for the tables that can be imported', async () => {
      const ok = await admin('GET', '/api/database/template/treatment_types')
      expect(ok.status).toBe(200)
      expect(String(ok.json?.data)).toContain('name')
      const refused = await admin('GET', '/api/database/template/payments')
      expect(refused.status).toBe(403)
    })
  })

  describe('columns only an expense category’s own screen may set', () => {
    // The ledger account must be a real, non-control Expense account, and the petty-cash flag and
    // reference type are checked together; a file would skip all of it.
    it.each([
      'accountId',
      'isPettyCash',
      'pettyRefType',
    ])('refuses a file with a %s column, and writes nothing', async (column) => {
      const csv = `name,${column}\n${TAG} cat ${column},x\n`
      const res = await admin('POST', '/api/database/import/expense_categories', { csv })
      expect(res.status, JSON.stringify(res.json)).toBe(400)
      expect(res.json?.error).toContain(column)
      expect(res.json?.error).toMatch(/cannot be imported/i)
      expect(await named(expenseCategories)).toEqual([])
    })

    it('refuses the same columns in a JSON list', async () => {
      const res = await admin('POST', '/api/database/import/expense_categories', [
        { name: `${TAG} json cat`, accountId: '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d' },
      ])
      expect(res.status, JSON.stringify(res.json)).toBe(400)
      expect(await named(expenseCategories)).toEqual([])
    })

    it('leaves them out of the template', async () => {
      const res = await admin('GET', '/api/database/template/expense_categories')
      expect(res.status).toBe(200)
      const columns = String(res.json?.data).split(',')
      expect(columns).toContain('name')
      for (const held of ['accountId', 'isPettyCash', 'pettyRefType']) {
        expect(columns).not.toContain(held)
      }
    })

    it('imports an expense category that does not carry them, with the usual defaults', async () => {
      const res = await admin('POST', '/api/database/import/expense_categories', {
        csv: `name,displayName\n${TAG} plain,Plain\n`,
      })
      expect(res.status, JSON.stringify(res.json)).toBe(200)
      expect(res.json).toMatchObject({ count: 1, existing: 0 })
      const [row] = await db
        .select()
        .from(expenseCategories)
        .where(ilike(expenseCategories.name, `${TAG} plain`))
      expect(row).toMatchObject({ accountId: null, isPettyCash: false, pettyRefType: 'none' })
    })
  })

  describe('reading the file', () => {
    it('keeps a value with a comma in it', async () => {
      const res = await admin('POST', '/api/database/import/treatment_types', {
        csv: `name,displayName,adaGroup\n"${TAG} Crown, porcelain",Crown,Restorative\n${TAG} Scaling,Scaling,Preventive\n`,
      })
      expect(res.status, JSON.stringify(res.json)).toBe(200)
      expect(res.json).toMatchObject({ success: true, count: 2, existing: 0, skipped: [] })
      const names = (await named(treatmentTypes)).map((r) => r.name).sort()
      expect(names).toEqual([`${TAG} Crown, porcelain`, `${TAG} Scaling`])
    })

    it('imports the good rows and says which it left out, and why', async () => {
      const res = await admin('POST', '/api/database/import/units', {
        csv:
          'name,displayName,isActive\n' +
          `${TAG} box,Box,true\n` +
          `${TAG} short\n` +
          `${TAG} bag,Bag,maybe\n` +
          `${TAG} roll,Roll,false\n` +
          ',Nameless,true\n',
      })
      expect(res.status, JSON.stringify(res.json)).toBe(200)
      expect(res.json?.count).toBe(2)
      expect(res.json?.skipped).toEqual([
        { row: 3, reason: expect.stringMatching(/1 value.*3 columns/i) },
        { row: 4, reason: expect.stringMatching(/isActive/) },
        { row: 6, reason: expect.stringMatching(/name.*required/i) },
      ])
      expect(res.json?.skippedTotal).toBe(3)
      expect((await named(units)).map((r) => r.name).sort()).toEqual([`${TAG} box`, `${TAG} roll`])
    })

    it('is safe to run twice: rows that are already there are counted, not an error', async () => {
      const csv = `name\n${TAG} twice A\n${TAG} twice B\n`
      const first = await admin('POST', '/api/database/import/units', { csv })
      expect(first.json).toMatchObject({ count: 2, existing: 0 })
      const second = await admin('POST', '/api/database/import/units', { csv })
      expect(second.status).toBe(200)
      expect(second.json).toMatchObject({ count: 0, existing: 2, skipped: [] })
    })

    it('refuses a file whose header does not fit the table, and writes nothing', async () => {
      const unknown = await admin('POST', '/api/database/import/units', {
        csv: `name,nonsense\n${TAG} h1,1\n`,
      })
      expect(unknown.status).toBe(400)
      expect(unknown.json?.error).toMatch(/nonsense/)
      const missing = await admin('POST', '/api/database/import/units', {
        csv: `displayName\n${TAG} h2\n`,
      })
      expect(missing.status).toBe(400)
      expect(missing.json?.error).toMatch(/name/)
      expect((await named(units)).map((r) => r.name)).not.toContain(`${TAG} h1`)
    })

    it('answers 400, with the reasons, when no row can be imported', async () => {
      const res = await admin('POST', '/api/database/import/units', {
        csv: `name,displayName\n${TAG} lone\n`,
      })
      expect(res.status).toBe(400)
      expect(res.json?.skipped).toHaveLength(1)
      expect(res.json?.error).toMatch(/no rows/i)
    })

    it('answers 400 for an empty file or a broken one', async () => {
      expect((await admin('POST', '/api/database/import/units', { csv: '' })).status).toBe(400)
      expect(
        (await admin('POST', '/api/database/import/units', { csv: 'name\n"unterminated\n' })).status
      ).toBe(400)
      const neither = await admin('POST', '/api/database/import/units', {})
      expect(neither.status).toBe(400)
      expect(neither.json?.error).toMatch(/Send the CSV as/)
      const wrongType = await admin('POST', '/api/database/import/units', { csv: 123 })
      expect(wrongType.status).toBe(400)
      expect(wrongType.json?.error).toMatch(/Send the CSV as/)
    })

    it('lists at most 200 of the rows it left out, and still says how many there were', async () => {
      const lone = Array.from({ length: 250 }, (_, i) => `${TAG} lone ${i}`).join('\n')
      const res = await admin('POST', '/api/database/import/units', {
        csv: `name,displayName\n${TAG} limit ok,Ok\n${lone}\n`,
      })
      expect(res.status, JSON.stringify(res.json).slice(0, 300)).toBe(200)
      expect(res.json).toMatchObject({ count: 1, skippedTotal: 250 })
      const listed = res.json?.skipped as Array<{ row: number }>
      expect(listed).toHaveLength(200)
      expect(listed[0].row).toBe(3) // row 1 is the header, row 2 the good one
      expect(listed[199].row).toBe(202)
    })

    it('is all or nothing: a row the database refuses undoes the rows imported before it', async () => {
      const boom = `${TAG} boom`
      await db.execute(
        sql.raw(`
          CREATE OR REPLACE FUNCTION it_import_fail_units() RETURNS trigger LANGUAGE plpgsql AS $fn$
          BEGIN
            IF NEW.name = '${boom}' THEN RAISE EXCEPTION 'it_import_fail_units: refused'; END IF;
            RETURN NEW;
          END $fn$`)
      )
      await db.execute(
        sql.raw(
          'CREATE TRIGGER it_import_fail_units BEFORE INSERT ON units FOR EACH ROW EXECUTE FUNCTION it_import_fail_units()'
        )
      )
      try {
        // 1100 good rows, then the refused one: it is in a later insert than the first rows
        const names = Array.from({ length: 1100 }, (_, i) => `${TAG} bulk ${i}`)
        const res = await admin('POST', '/api/database/import/units', {
          csv: `name\n${[...names, boom].join('\n')}\n`,
        })
        expect(res.status).toBe(500)
        const left = (await named(units)).filter((r) => r.name.startsWith(`${TAG} bulk`))
        expect(left).toEqual([])
      } finally {
        await db.execute(sql.raw('DROP TRIGGER IF EXISTS it_import_fail_units ON units'))
        await db.execute(sql.raw('DROP FUNCTION IF EXISTS it_import_fail_units()'))
      }
    })

    it('refuses a JSON list of more than 5000 records, and writes nothing', async () => {
      const list = Array.from({ length: 5001 }, (_, i) => ({ name: `${TAG} many ${i}` }))
      const res = await admin('POST', '/api/database/import/units', list)
      expect(res.status).toBe(400)
      expect(res.json?.error).toMatch(/5000/)
      const left = (await named(units)).filter((r) => r.name.startsWith(`${TAG} many`))
      expect(left).toEqual([])
    })

    it('writes an audit entry that says what the import did', async () => {
      // one row is already there, one is new, one is left out: three different numbers
      await admin('POST', '/api/database/import/units', { csv: `name\n${TAG} audited\n` })
      const res = await admin('POST', '/api/database/import/units', {
        csv: `name,displayName\n${TAG} audited,Au\n${TAG} audited two,Au2\n${TAG} audited lone\n`,
      })
      expect(res.status, JSON.stringify(res.json)).toBe(200)
      expect(res.json).toMatchObject({ count: 1, existing: 1, skippedTotal: 1 })
      const [entry] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.userId, adminUserId),
            eq(auditLogs.module, 'database'),
            eq(auditLogs.entityId, 'units')
          )
        )
        .orderBy(desc(auditLogs.createdAt))
        .limit(1)
      expect(entry?.action).toBe('create')
      expect(entry?.changes).toMatchObject({
        action: 'import',
        tableName: 'units',
        count: 1,
        existing: 1,
        skipped: 1,
      })
    })

    it('still accepts a JSON list of records, and checks it the same way', async () => {
      const ok = await admin('POST', '/api/database/import/units', [
        { name: `${TAG} legacy`, displayName: 'Legacy', isActive: true },
        { name: `${TAG} legacy bad`, isActive: 'perhaps' },
      ])
      expect(ok.status, JSON.stringify(ok.json)).toBe(200)
      expect(ok.json).toMatchObject({ count: 1 })
      expect(ok.json?.skipped).toEqual([{ row: 3, reason: expect.stringMatching(/isActive/) }])
      const unknown = await admin('POST', '/api/database/import/units', [
        { name: `${TAG} legacy 2`, secret: 'x' },
      ])
      expect(unknown.status).toBe(400)
    })
  })
})
