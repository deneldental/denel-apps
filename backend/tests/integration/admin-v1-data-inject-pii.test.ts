/**
 * admin-v1 §22.1 + §22.2 — Data Inject PII scoping + publish audit.
 *
 * §22.2: when a section is published to the reports app's separate DB, the
 *   admin's chosen PII scope (include / omit / mask) must strip or anonymize
 *   sensitive patient PII (name / phone / dob / email / address …) BEFORE the
 *   payload crosses the DB boundary (DPA data-minimisation).
 * §22.1: every publish is recorded in the audit trail — who moved which section,
 *   when, how many rows, under which PII scope (DPA accountability for cross-DB
 *   movement).
 *
 * Run with `doppler run -- pnpm --filter backend test admin-v1-data-inject-pii`
 * (gated on DATABASE_URL; `pnpm test` alone skips). The DB-touching tests run
 * inside `withRollback` — a transaction that is ALWAYS rolled back — so the
 * shared dev DB is never mutated.
 *
 * The PII-transform tests are pure (no DB) and always run; the publish +
 * audit-write tests drive the exported service fns (`buildSectionPayload` builds
 * the raw rows; `scopePayloadPii` scopes them; `createAuditLog` writes the
 * accountability row) — the same pieces the POST /:section/publish route wires
 * together.
 */

import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { DB } from '../../src/db'
import { auditLogs, patients, reportsInjectionConfig } from '../../src/db/schema'
import { createAuditLog } from '../../src/lib/audit'
import {
  piiFieldsForSection,
  resolvePiiScope,
  scopePayloadPii,
  scopeRowPii,
} from '../../src/lib/reports-injection-pii'
import { buildSectionPayload } from '../../src/routes/reports-injection'
import { anyUserId } from './_fixtures'
import { noDb, withRollback } from './_setup'

// The direct identifiers we expect a published patient_records row to lose.
const PII = [
  'name',
  'email',
  'phone',
  'dob',
  'address',
  'emergencyContactName',
  'emergencyContactPhone',
] as const

// ── §22.2 — the pure PII-scoping transform (no DB) ────────────────────────────

describe('admin-v1 §22.2 — PII scoping transform', () => {
  const sampleRow = {
    id: 'p1',
    name: 'Jane Doe',
    email: 'jane@example.com',
    phone: '0244000000',
    dob: new Date('1990-01-01'),
    address: '12 Clinic Rd',
    category: 'ongoing',
    createdAt: new Date('2026-01-01'),
  }

  it('include keeps PII but ALWAYS strips credential fields (pwaPasswordHash)', () => {
    // include preserves the patient identifiers (legacy reports-app contract)…
    const out = scopeRowPii('patient_records', sampleRow, 'include')
    expect(out).toEqual(sampleRow)
    // …but a credential hash must never cross to the reports DB, in ANY mode.
    const withSecret = { ...sampleRow, pwaPasswordHash: 'pbkdf2$leak' }
    for (const mode of ['include', 'omit', 'mask'] as const) {
      expect(scopeRowPii('patient_records', withSecret, mode)).not.toHaveProperty('pwaPasswordHash')
    }
  })

  it('omit strips every PII field but keeps non-PII fields', () => {
    const out = scopeRowPii('patient_records', sampleRow, 'omit')
    for (const f of PII) expect(out).not.toHaveProperty(f)
    // Non-PII identifiers survive so the reports app still has joinable keys.
    expect(out.id).toBe('p1')
    expect(out.category).toBe('ongoing')
    expect(out.createdAt).toEqual(sampleRow.createdAt)
  })

  it('mask keeps the PII keys present but replaces the values (anonymized)', () => {
    const out = scopeRowPii('patient_records', sampleRow, 'mask') as Record<string, unknown>
    expect(out).toHaveProperty('name')
    expect(out.name).not.toBe('Jane Doe')
    expect(out.email).not.toBe('jane@example.com')
    expect(out.phone).not.toBe('0244000000')
    // A masked Date collapses to null so the column type still fits.
    expect(out.dob).toBeNull()
    // Non-PII fields keep their real values.
    expect(out.id).toBe('p1')
    expect(out.category).toBe('ongoing')
  })

  it('is a no-op for sections that carry no patient PII', () => {
    expect(piiFieldsForSection('finance')).toHaveLength(0)
    const out = scopeRowPii('finance', { id: 'x', total: 100 }, 'omit')
    expect(out).toEqual({ id: 'x', total: 100 })
  })

  it('resolvePiiScope reads piiScope from config and defaults to include', () => {
    expect(resolvePiiScope({ piiScope: 'omit' })).toBe('omit')
    expect(resolvePiiScope({ piiScope: 'mask' })).toBe('mask')
    expect(resolvePiiScope({})).toBe('include')
    expect(resolvePiiScope({ piiScope: 'bogus' })).toBe('include')
    expect(resolvePiiScope(null)).toBe('include')
  })

  it('scopePayloadPii applies the transform across an array', () => {
    const rows = [sampleRow, { ...sampleRow, id: 'p2', name: 'John Roe' }]
    const omitted = scopePayloadPii('patient_records', rows, 'omit')
    expect(omitted).toHaveLength(2)
    for (const r of omitted) for (const f of PII) expect(r).not.toHaveProperty(f)
    // Source rows are not mutated.
    expect(rows[0].name).toBe('Jane Doe')
  })
})

// ── §22.2 + §22.1 — publish a real row, scope it, and write the audit ─────────

describe.skipIf(noDb)('admin-v1 §22.1/§22.2 — publish builds a scoped payload + audits it', () => {
  it('a published patient_records payload with piiScope=omit drops PII; an audit row is written', async () => {
    await withRollback(async (tx: DB) => {
      const userId = await anyUserId(tx)
      const tag = randomUUID().slice(0, 8)

      // Seed one patient with rich PII.
      const [patient] = await tx
        .insert(patients)
        .values({
          name: `IT PII ${tag}`,
          email: `it-${tag}@example.com`,
          phone: '0244999000',
          dob: new Date('1991-02-03'),
          gender: 'other',
          address: '5 Test Ave',
          category: 'ongoing',
          emergencyContactName: 'Next Of Kin',
          emergencyContactPhone: '0200111222',
        })
        .returning()

      // Enable the section with an omit scope (mirrors what the PUT config writes).
      // The section row is seeded by migration, so upsert rather than plain insert.
      const [cfg] = await tx
        .insert(reportsInjectionConfig)
        .values({
          section: 'patient_records',
          enabled: true,
          config: { piiScope: 'omit', limit: 5000 },
          updatedById: userId,
        })
        .onConflictDoUpdate({
          target: reportsInjectionConfig.section,
          set: { enabled: true, config: { piiScope: 'omit', limit: 5000 }, updatedById: userId },
        })
        .returning()

      const scope = resolvePiiScope(cfg.config)
      expect(scope).toBe('omit')

      // 1. Build the raw payload (PII intact) — the row we inserted is present.
      const rawRows = await buildSectionPayload(tx as never, 'patient_records', cfg.config as never)
      const rawMine = rawRows.find((r) => r.id === patient.id)
      expect(rawMine).toBeTruthy()
      expect((rawMine as Record<string, unknown>).name).toBe(`IT PII ${tag}`)
      expect((rawMine as Record<string, unknown>).phone).toBe('0244999000')

      // 2. §22.2 — scope the payload before it would cross to the reports DB.
      const scopedRows = scopePayloadPii('patient_records', rawRows, scope)
      const scopedMine = scopedRows.find((r) => (r as Record<string, unknown>).id === patient.id)
      expect(scopedMine).toBeTruthy()
      for (const f of PII) expect(scopedMine).not.toHaveProperty(f)
      // The non-PII id survives so reports can still key on it.
      expect((scopedMine as Record<string, unknown>).id).toBe(patient.id)

      // 3. §22.1 — write the publish audit row (who / section / when / count / scope).
      const log = await createAuditLog(tx as never, {
        userId,
        action: 'publish',
        module: 'data_inject',
        entityId: cfg.id,
        entityName: 'Reports injection publish — patient_records',
        changes: { section: 'patient_records', piiScope: scope, rowCount: scopedRows.length },
      })
      expect(log).toBeTruthy()

      const [row] = await tx
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.module, 'data_inject'),
            eq(auditLogs.action, 'publish'),
            eq(auditLogs.entityId, cfg.id)
          )
        )
        .limit(1)
      expect(row).toBeTruthy()
      expect(row.userId).toBe(userId)
      expect(row.entityId).toBe(cfg.id)
      const changes = row.changes as Record<string, unknown>
      expect(changes.section).toBe('patient_records')
      expect(changes.piiScope).toBe('omit')
    })
  })

  it('a published payload with piiScope=mask keeps keys present but anonymizes values', async () => {
    await withRollback(async (tx: DB) => {
      const userId = await anyUserId(tx)
      const tag = randomUUID().slice(0, 8)

      const [patient] = await tx
        .insert(patients)
        .values({
          name: `IT MASK ${tag}`,
          phone: '0244888000',
          dob: new Date('1985-05-05'),
          gender: 'other',
          category: 'ongoing',
        })
        .returning()

      const [cfg] = await tx
        .insert(reportsInjectionConfig)
        .values({
          section: 'patient_records',
          enabled: true,
          config: { piiScope: 'mask', limit: 5000 },
          updatedById: userId,
        })
        .onConflictDoUpdate({
          target: reportsInjectionConfig.section,
          set: { enabled: true, config: { piiScope: 'mask', limit: 5000 }, updatedById: userId },
        })
        .returning()

      const rawRows = await buildSectionPayload(tx as never, 'patient_records', cfg.config as never)
      const scopedRows = scopePayloadPii('patient_records', rawRows, resolvePiiScope(cfg.config))
      const mine = scopedRows.find((r) => (r as Record<string, unknown>).id === patient.id) as
        | Record<string, unknown>
        | undefined

      expect(mine).toBeTruthy()
      // Keys present, values anonymized.
      expect(mine).toHaveProperty('name')
      expect(mine?.name).not.toBe(`IT MASK ${tag}`)
      expect(mine).toHaveProperty('phone')
      expect(mine?.phone).not.toBe('0244888000')
      expect(mine?.dob).toBeNull()
    })
  })
})
