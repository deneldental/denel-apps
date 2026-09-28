/**
 * The startup self-heal must never re-create `payments_method_check`.
 *
 * Migration 0214 dropped that CHECK because payment methods are admin-
 * configurable (the `payment_methods` lookup) and a fixed DB-level slug list
 * rejected every custom method at INSERT — a production incident. Step 10 of
 * this self-heal then re-added the constraint on every boot, silently undoing
 * 0214 (found while testing settings-domain-audit B6). This pins the fix.
 */
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { ensureDoctorSpecialistSchema } from '../../src/lib/doctor-specialist-schema'

const dialect = new PgDialect()

describe('ensureDoctorSpecialistSchema', () => {
  it('does not touch payments_method_check at all', async () => {
    const executed: string[] = []
    const db = {
      execute: vi.fn(async (stmt: Parameters<PgDialect['sqlToQuery']>[0]) => {
        executed.push(dialect.sqlToQuery(stmt).sql)
        return []
      }),
    }

    await ensureDoctorSpecialistSchema(
      db as unknown as Parameters<typeof ensureDoctorSpecialistSchema>[0]
    )

    expect(executed.length).toBeGreaterThan(0)
    expect(executed.filter((s) => /payments_method_check/i.test(s))).toEqual([])
  })
})
