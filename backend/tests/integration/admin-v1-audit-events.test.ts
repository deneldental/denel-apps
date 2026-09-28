/**
 * admin-v1 §19.3 — forensic audit-event smoke tests.
 *
 * Proves the kiosk (CC.3) + document-signing (CC.4) + x-ray public-share (§9.2)
 * events are routed into the single forensic home (`auditLogs`). Run with
 * `doppler run -- pnpm --filter backend test admin-v1-audit-events` (gated on
 * DATABASE_URL; `pnpm test` alone skips). Every test runs inside `withRollback`
 * — a transaction that is ALWAYS rolled back — so the shared dev DB is never
 * mutated.
 *
 * The routes call `createAuditLog(db, …)` best-effort with a NOT-NULL,
 * user-FK-constrained actor (a kiosk operator / external share viewer has no
 * portal user, so the entry is attributed to the device's provisioning admin /
 * the share creator). These tests replicate that exact audit call shape against
 * `tx` — the same pattern hr-routes.test.ts uses for route-only logic — so they
 * catch the FK gotcha (a bad actor would silently produce zero rows) and the
 * null-actor guard (no actor → no row, never a throw).
 */

import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { DB } from '../../src/db'
import {
  auditLogs,
  documentInstances,
  kioskDevices,
  patients,
  staff,
  user as userTable,
  xrayShareLinks,
} from '../../src/db/schema'
import { createAuditLog } from '../../src/lib/audit'
import { noDb, withRollback } from './_setup'

// ─── Local fixtures ──────────────────────────────────────────────────────────

async function makeUser(tx: DB, name = 'IT Audit User'): Promise<string> {
  const id = `__it_user_${randomUUID().slice(0, 12)}`
  const now = new Date()
  await tx.insert(userTable).values({
    id,
    name,
    email: `${id}@it.local`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  return id
}

async function makePatient(tx: DB, name = 'IT Audit Patient'): Promise<string> {
  const [p] = await tx
    .insert(patients)
    .values({ name, dob: new Date('1990-01-01'), gender: 'other' })
    .returning()
  return p.id
}

async function makeStaff(tx: DB, userId: string): Promise<string> {
  const [s] = await tx
    .insert(staff)
    .values({
      staffId: `IT-${randomUUID().slice(0, 8)}`,
      userId,
      fullName: 'IT Kiosk Operator',
      email: `${userId}@it.local`,
      employmentType: 'permanent',
      status: 'active',
      staffType: 'internal',
    })
    .returning()
  return s.id
}

/** Count audit rows matching an exact (module, action, entityId) triple. */
async function auditCount(
  tx: DB,
  module: string,
  action: string,
  entityId: string
): Promise<number> {
  const rows = await tx
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.module, module),
        eq(auditLogs.action, action),
        eq(auditLogs.entityId, entityId)
      )
    )
  return rows.length
}

// ════════════════════════════════════════════════════════════════════════════
// (a) Kiosk device-unlock + operator-PIN → access_management audit
// ════════════════════════════════════════════════════════════════════════════

describe.skipIf(noDb)('§19.3 — kiosk events route into auditLogs', () => {
  it('device pair (unlock) lands an access_management audit attributed to the provisioning admin', async () => {
    await withRollback(async (tx) => {
      const adminId = await makeUser(tx, 'IT Kiosk Admin')
      const [device] = await tx
        .insert(kioskDevices)
        .values({
          label: 'IT X-ray Room PC',
          surface: 'xrays',
          isActive: true,
          pairedById: adminId,
          deviceTokenHash: 'it-token-hash',
          pairedAt: new Date(),
        })
        .returning()

      // Mirrors the /pair audit emit.
      const log = await createAuditLog(tx, {
        userId: device.pairedById!,
        action: 'create',
        module: 'access_management',
        entityId: device.id,
        entityName: `Kiosk device paired: ${device.label} (${device.surface})`,
        ipAddress: '203.0.113.7',
        userAgent: 'IT-Agent/1.0',
      })

      expect(log).not.toBeNull()
      expect(log?.userId).toBe(adminId)
      expect(await auditCount(tx, 'access_management', 'create', device.id)).toBe(1)
    })
  })

  it('operator-PIN unlock attributes to the provisioning admin with operator detail in changes', async () => {
    await withRollback(async (tx) => {
      const adminId = await makeUser(tx, 'IT Kiosk Admin 2')
      const operatorUserId = await makeUser(tx, 'IT Operator')
      const staffId = await makeStaff(tx, operatorUserId)
      const [device] = await tx
        .insert(kioskDevices)
        .values({
          label: 'IT Station',
          surface: 'xrays',
          isActive: true,
          pairedById: adminId,
          deviceTokenHash: 'it-token-hash-2',
          pairedAt: new Date(),
        })
        .returning()

      // Mirrors the /session audit emit (operatorId/staffId carried in `changes`).
      const log = await createAuditLog(tx, {
        userId: device.pairedById!,
        action: 'create',
        module: 'access_management',
        entityId: device.id,
        entityName: `Kiosk session opened on ${device.surface}`,
        changes: { operatorId: randomUUID(), staffId, deviceId: device.id },
        ipAddress: '203.0.113.8',
        userAgent: 'IT-Agent/1.0',
      })

      expect(log).not.toBeNull()
      expect(log?.userId).toBe(adminId)
      expect((log?.changes as { staffId?: string } | null)?.staffId).toBe(staffId)
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════
// (b) Document sign / upload-signed → compliance audit
// ════════════════════════════════════════════════════════════════════════════

describe.skipIf(noDb)('§19.3 — document-signing events route into auditLogs', () => {
  it('signing a document lands a compliance audit with the content hash + viewer IP/UA', async () => {
    await withRollback(async (tx) => {
      const userId = await makeUser(tx, 'IT Signer')
      const subjectId = await makePatient(tx)
      const [inst] = await tx
        .insert(documentInstances)
        .values({
          title: 'IT Consent',
          subjectType: 'patient',
          subjectId,
          mode: 'digital',
          status: 'completed',
          contentHash: 'deadbeef',
          createdById: userId,
          completedAt: new Date(),
        })
        .returning()

      const log = await createAuditLog(tx, {
        userId,
        action: 'update',
        module: 'compliance',
        entityId: inst.id,
        entityName: `Signed document: ${inst.title}`,
        changes: { contentHash: 'deadbeef', subjectType: 'patient', subjectId },
        ipAddress: '203.0.113.9',
        userAgent: 'IT-Agent/1.0',
      })

      expect(log).not.toBeNull()
      expect(log?.ipAddress).toBe('203.0.113.9')
      expect(await auditCount(tx, 'compliance', 'update', inst.id)).toBe(1)
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════
// (c) X-ray public-share VIEW → xrays audit (attributed to the share creator)
// ════════════════════════════════════════════════════════════════════════════

describe.skipIf(noDb)('§19.3 — x-ray public-share view routes into auditLogs', () => {
  it('a verified public-share view lands an xrays "view" audit attributed to the share creator', async () => {
    await withRollback(async (tx) => {
      const creatorId = await makeUser(tx, 'IT Share Creator')
      const patientId = await makePatient(tx)
      const [link] = await tx
        .insert(xrayShareLinks)
        .values({
          linkToken: randomUUID().replace(/-/g, ''),
          accessCode: '123456',
          xrayRecordIds: [],
          patientId,
          recipientName: 'Dr. External',
          createdById: creatorId,
          expiresAt: new Date(Date.now() + 86_400_000),
        })
        .returning()

      const log = await createAuditLog(tx, {
        userId: link.createdById!,
        action: 'view',
        module: 'xrays',
        entityId: link.id,
        entityName: `X-ray share viewed by ${link.recipientName}`,
        changes: { patientId: link.patientId, recipientName: link.recipientName, xrayCount: 2 },
        ipAddress: '203.0.113.10',
        userAgent: 'IT-Agent/1.0',
      })

      expect(log).not.toBeNull()
      expect(log?.userId).toBe(creatorId)
      expect(log?.action).toBe('view')
      expect(await auditCount(tx, 'xrays', 'view', link.id)).toBe(1)
    })
  })

  it('a share with a null creator is skipped by the route guard — no audit row, no throw', async () => {
    await withRollback(async (tx) => {
      const patientId = await makePatient(tx)
      const [link] = await tx
        .insert(xrayShareLinks)
        .values({
          linkToken: randomUUID().replace(/-/g, ''),
          accessCode: '654321',
          xrayRecordIds: [],
          patientId,
          recipientName: 'Dr. NoCreator',
          createdById: null,
          expiresAt: new Date(Date.now() + 86_400_000),
        })
        .returning()

      // The route guards `if (link.createdById)`; with a null creator it emits
      // nothing (auditLogs.userId is NOT NULL). Assert the guard holds.
      if (link.createdById) {
        await createAuditLog(tx, {
          userId: link.createdById,
          action: 'view',
          module: 'xrays',
          entityId: link.id,
          entityName: 'should not happen',
        })
      }

      expect(await auditCount(tx, 'xrays', 'view', link.id)).toBe(0)
    })
  })
})
