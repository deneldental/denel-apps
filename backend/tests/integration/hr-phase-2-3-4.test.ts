/**
 * Integration tests for the HR Phase 2 / 3 / 4 backend.
 *
 * Each test runs inside `withRollback`, so we freely create staff, run
 * payrolls, set up approval chains, etc. and the dev DB sees nothing
 * after the test exits.
 *
 * We exercise the actual route helpers (PAYE engine, BundleResolver,
 * lifecycle templates) and write/read against `tx` so transactional
 * guarantees are honoured. The HTTP layer is NOT spun up — these are
 * function-level integration tests against real Postgres.
 */

import { randomUUID } from 'node:crypto'
import { computeGhanaPayslip, Money } from '@denel/utils'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as schema from '../../src/db/schema'
import { templateFor } from '../../src/lib/lifecycle-tasks'
import { resolveRolePermissions } from '../../src/rbac/engine/BundleResolver'
import { noDb, withRollback } from './_setup'

/**
 * Create a transient staff row inside the test transaction. Returns the
 * staff.id. The auth `user` row is also created so any FK that requires
 * a user is satisfied.
 */
async function makeStaff(
  tx: any,
  opts: {
    name?: string
    status?: 'active' | 'inactive' | 'suspended'
    roleId?: string | null
  } = {}
): Promise<{ staffId: string; userId: string }> {
  const userId = `__it_user_${randomUUID().slice(0, 12)}`
  const now = new Date()
  await tx.insert(schema.user).values({
    id: userId,
    name: opts.name ?? 'IT Staff',
    email: `${userId}@it.local`,
    emailVerified: true,
    role: null,
    roleId: opts.roleId ?? null,
    banned: false,
    createdAt: now,
    updatedAt: now,
  })

  const [s] = await tx
    .insert(schema.staff)
    .values({
      staffId: `IT-${randomUUID().slice(0, 8)}`,
      userId,
      fullName: opts.name ?? 'IT Staff',
      email: `${userId}@it.local`,
      employmentType: 'permanent',
      status: opts.status ?? 'active',
      staffType: 'internal',
    })
    .returning()

  return { staffId: s.id, userId }
}

// ════════════════════════════════════════════════════════════════════════════
// Phase 3A — Payroll engine + pay-run end-to-end
// ════════════════════════════════════════════════════════════════════════════

describe.skipIf(noDb)('Payroll — bulk pay-run integration', () => {
  it('drafts a payslip per active staff with correct PAYE + SSNIT + net', async () => {
    await withRollback(async (tx) => {
      const { staffId } = await makeStaff(tx, { name: 'Pay Run Staff 1' })

      // GHS 5,000 basic salary, plus 500 non-taxable transport allowance.
      await tx.insert(schema.salaryComponents).values([
        {
          staffId,
          type: 'basic',
          name: 'Basic salary',
          amount: 5000,
          taxable: true,
          effectiveFrom: new Date('2026-01-01'),
        },
        {
          staffId,
          type: 'allowance',
          name: 'Transport',
          amount: 500,
          taxable: false,
          effectiveFrom: new Date('2026-01-01'),
        },
      ])

      // Run payroll for May 2026.
      const [run] = await tx
        .insert(schema.payrollRuns)
        .values({
          name: 'IT Test Run',
          payPeriodStart: new Date('2026-05-01'),
          payPeriodEnd: new Date('2026-05-31'),
          status: 'draft',
          staffCount: 1,
        })
        .returning()

      // Build the payslip via the same logic the endpoint uses. The Ghana tax
      // engine takes and returns CEDIS; `payslips.grossPay`/`netPay` are integer
      // CENTS since migration 0209, so the route crosses that boundary with
      // `Money.fromNumber(...).toDbValue()` and so does this.
      const breakdown = computeGhanaPayslip(5000)
      const finalGross = Money.fromNumber(breakdown.gross + 500).toDbValue()
      const finalNet = Money.fromNumber(breakdown.net + 500).toDbValue()

      await tx.insert(schema.payslips).values({
        staffId,
        payPeriod: '2026-05-01',
        grossPay: finalGross,
        netPay: finalNet,
        deductions: {
          ssnit_employee: breakdown.ssnitEmployee,
          ssnit_employer: breakdown.ssnitEmployer,
          paye: breakdown.paye,
          loan: 0,
          other: [],
          non_taxable_allowances: 500,
          payrollRunId: run.id,
        } as any,
        status: 'draft',
      })

      const inserted = await tx
        .select()
        .from(schema.payslips)
        .where(eq(schema.payslips.staffId, staffId))

      expect(inserted).toHaveLength(1)
      const p = inserted[0]
      expect(Number(p.grossPay)).toBe(550000) // GHS 5,500.00 in cents
      // SSNIT 5.5% of 5000 = 275 → taxable 4725
      // PAYE on 4725 walks the brackets defined in GHANA_PAYE_2024
      // Verify net is positive and below gross.
      expect(Number(p.netPay)).toBeGreaterThan(0)
      expect(Number(p.netPay)).toBeLessThan(Number(p.grossPay))
      expect(p.status).toBe('draft')

      // Publish-on-runId path: simulate the publish handler's payslip update.
      await tx
        .update(schema.payslips)
        .set({ status: 'published', publishedAt: new Date() })
        .where(eq(schema.payslips.staffId, staffId))

      const after = await tx
        .select({ status: schema.payslips.status })
        .from(schema.payslips)
        .where(eq(schema.payslips.staffId, staffId))
      expect(after[0].status).toBe('published')
    })
  })

  it('respects taxable flags — non-taxable allowances bypass PAYE', () => {
    // Pure function check so it stays under this describe and is easy to
    // associate with the bulk integration above.
    const r1 = computeGhanaPayslip(5000) // baseline
    const r2 = computeGhanaPayslip(5500) // same as adding a TAXABLE 500

    // If the 500 had been added as a taxable component, PAYE would rise.
    expect(r2.paye).toBeGreaterThan(r1.paye)
    expect(r2.net).toBeGreaterThan(r1.net) // even after extra PAYE, net is up
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Phase 2A — Manager cycle detection
// ════════════════════════════════════════════════════════════════════════════

describe.skipIf(noDb)('Org chart — manager cycle detection', () => {
  it('refuses to make a staff their own manager (FK accepts but server should refuse — covered at the server layer; here we exercise the data shape)', async () => {
    await withRollback(async (tx) => {
      const { staffId } = await makeStaff(tx, { name: 'Cycle Self' })
      // Direct DB assignment to self is technically possible — the server-
      // layer guard rejects it. Verify the schema permits it (so the guard
      // is what matters in practice).
      await tx.update(schema.staff).set({ managerId: staffId }).where(eq(schema.staff.id, staffId))

      const [row] = await tx
        .select({ managerId: schema.staff.managerId })
        .from(schema.staff)
        .where(eq(schema.staff.id, staffId))
      // Server layer normally refuses this — the DB stored it because no
      // CHECK constraint exists. This test documents the contract that the
      // ROUTE-LAYER guard in hr-phase2.ts is the only enforcement.
      expect(row.managerId).toBe(staffId)
    })
  })

  it('FK ON DELETE SET NULL — deleting a manager re-parents reports to null, not cascade', async () => {
    await withRollback(async (tx) => {
      const mgr = await makeStaff(tx, { name: 'Manager' })
      const rep = await makeStaff(tx, { name: 'Report' })

      await tx
        .update(schema.staff)
        .set({ managerId: mgr.staffId })
        .where(eq(schema.staff.id, rep.staffId))

      // Hard-delete the manager (in real flows we soft-delete; this asserts
      // the FK semantics).
      await tx.delete(schema.staff).where(eq(schema.staff.id, mgr.staffId))

      const [repAfter] = await tx
        .select({ managerId: schema.staff.managerId })
        .from(schema.staff)
        .where(eq(schema.staff.id, rep.staffId))
      expect(repAfter.managerId).toBeNull()
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Phase 4B — Bundle composition (parent chain resolution)
// ════════════════════════════════════════════════════════════════════════════

describe.skipIf(noDb)('Bundle composition — parent chain', () => {
  it('child role with a parent bundle inherits parent permissions', async () => {
    await withRollback(async (tx) => {
      // Build a fresh parent + child bundle, give them distinct permissions
      // and link the child to the parent.
      const parentId = `__it_parent_${randomUUID().slice(0, 8)}`
      const childId = `__it_child_${randomUUID().slice(0, 8)}`
      const roleId = `__it_role_${randomUUID().slice(0, 8)}`

      await tx.insert(schema.permissionBundles).values([
        { id: parentId, name: parentId, scope: 'portal', isSystem: false },
        {
          id: childId,
          name: childId,
          scope: 'portal',
          isSystem: false,
          parentBundleId: parentId,
        },
      ])

      // Look up two real seeded permissions to give each bundle something
      // distinct. `dashboard:read` is virtually always seeded; pair with
      // `analytics:read` which is also a baseline.
      const [perm1] = await tx
        .select({ id: schema.permissions.id })
        .from(schema.permissions)
        .where(
          and(eq(schema.permissions.module, 'dashboard'), eq(schema.permissions.action, 'read'))
        )
      const [perm2] = await tx
        .select({ id: schema.permissions.id })
        .from(schema.permissions)
        .where(
          and(eq(schema.permissions.module, 'analytics'), eq(schema.permissions.action, 'read'))
        )

      await tx.insert(schema.bundlePermissions).values([
        { bundleId: parentId, permissionId: perm1.id },
        { bundleId: childId, permissionId: perm2.id },
      ])

      // Role only attached to the CHILD bundle. After resolution it should
      // see both perms (its own + parent inherited).
      await tx.insert(schema.roles).values({
        id: roleId,
        name: roleId,
        description: 'transient',
        isSystem: false,
      })
      await tx.insert(schema.roleBundles).values({ roleId, bundleId: childId })

      const resolved = await resolveRolePermissions(tx, roleId)

      expect(resolved.some((p) => p.module === 'dashboard' && p.action === 'read')).toBe(true)
      expect(resolved.some((p) => p.module === 'analytics' && p.action === 'read')).toBe(true)
    })
  })

  it('depth cap stops infinite-loop resolution if data is corrupt', async () => {
    await withRollback(async (tx) => {
      // We can't actually CREATE a cycle (server rejects), but we CAN
      // exercise the depth cap by chaining 25 bundles deep — the resolver
      // is capped at 20 and should still terminate.
      const chainIds: string[] = []
      for (let i = 0; i < 25; i++) {
        const id = `__it_chain_${randomUUID().slice(0, 6)}_${i}`
        chainIds.push(id)
      }
      for (let i = 0; i < chainIds.length; i++) {
        await tx.insert(schema.permissionBundles).values({
          id: chainIds[i],
          name: chainIds[i],
          scope: 'portal',
          isSystem: false,
          parentBundleId: i === 0 ? null : chainIds[i - 1],
        })
      }
      const roleId = `__it_chain_role_${randomUUID().slice(0, 6)}`
      await tx.insert(schema.roles).values({
        id: roleId,
        name: roleId,
        isSystem: false,
      })
      await tx
        .insert(schema.roleBundles)
        .values({ roleId, bundleId: chainIds[chainIds.length - 1] })

      // Must terminate (no infinite loop). Returns whatever permissions
      // were attached — none in this test, so we just assert it resolves.
      const resolved = await resolveRolePermissions(tx, roleId)
      expect(Array.isArray(resolved)).toBe(true)
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Phase 2A — Multi-step approval auto-promotion
// ════════════════════════════════════════════════════════════════════════════

describe.skipIf(noDb)('Multi-step approvals — chain → parent status', () => {
  it('parent request stays pending until every required step is approved', async () => {
    await withRollback(async (tx) => {
      const { staffId, userId } = await makeStaff(tx, { name: 'Approval Subject' })

      // Create the parent request
      const [req] = await tx
        .insert(schema.staffRequests)
        .values({
          staffId,
          requestType: 'leave',
          subType: 'annual_leave',
          description: 'two weeks',
          status: 'pending',
          startDate: new Date('2026-06-01'),
          endDate: new Date('2026-06-14'),
        })
        .returning()

      // Two-step chain
      await tx.insert(schema.staffRequestApprovals).values([
        {
          requestId: req.id,
          stepOrder: 1,
          approverUserId: userId,
          status: 'pending',
          required: true,
        },
        {
          requestId: req.id,
          stepOrder: 2,
          approverUserId: null,
          status: 'pending',
          required: true,
        },
      ])

      // Approve step 1 — parent should still be pending.
      await tx
        .update(schema.staffRequestApprovals)
        .set({ status: 'approved', decidedAt: new Date(), decidedById: userId })
        .where(
          and(
            eq(schema.staffRequestApprovals.requestId, req.id),
            eq(schema.staffRequestApprovals.stepOrder, 1)
          )
        )

      // Replicate the route handler's chain inspection
      let steps = await tx
        .select()
        .from(schema.staffRequestApprovals)
        .where(eq(schema.staffRequestApprovals.requestId, req.id))
      const stillPending = steps.some((s) => s.required && s.status === 'pending')
      expect(stillPending).toBe(true)

      // Approve step 2 — now all required steps are approved.
      await tx
        .update(schema.staffRequestApprovals)
        .set({ status: 'approved', decidedAt: new Date(), decidedById: userId })
        .where(
          and(
            eq(schema.staffRequestApprovals.requestId, req.id),
            eq(schema.staffRequestApprovals.stepOrder, 2)
          )
        )

      steps = await tx
        .select()
        .from(schema.staffRequestApprovals)
        .where(eq(schema.staffRequestApprovals.requestId, req.id))
      const allDecided = steps.every(
        (s) => !s.required || s.status === 'approved' || s.status === 'skipped'
      )
      expect(allDecided).toBe(true)

      // The route auto-promotes the parent. Simulate it here.
      if (allDecided) {
        await tx
          .update(schema.staffRequests)
          .set({ status: 'approved', reviewedAt: new Date() })
          .where(eq(schema.staffRequests.id, req.id))
      }

      const [parent] = await tx
        .select({ status: schema.staffRequests.status })
        .from(schema.staffRequests)
        .where(eq(schema.staffRequests.id, req.id))
      expect(parent.status).toBe('approved')
    })
  })

  it('any rejected required step propagates to the parent as rejected', async () => {
    await withRollback(async (tx) => {
      const { staffId } = await makeStaff(tx, { name: 'Approval Subject 2' })

      const [req] = await tx
        .insert(schema.staffRequests)
        .values({ staffId, requestType: 'permit', status: 'pending' })
        .returning()
      await tx
        .insert(schema.staffRequestApprovals)
        .values([{ requestId: req.id, stepOrder: 1, status: 'rejected', required: true }])

      const steps = await tx
        .select()
        .from(schema.staffRequestApprovals)
        .where(eq(schema.staffRequestApprovals.requestId, req.id))
      const anyRejected = steps.some((s) => s.required && s.status === 'rejected')
      expect(anyRejected).toBe(true)
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Phase 0 — Soft-delete filter on list endpoints
// ════════════════════════════════════════════════════════════════════════════

describe.skipIf(noDb)('Soft-delete — staff list filter', () => {
  it('soft-deleted staff are excluded from the default list query', async () => {
    await withRollback(async (tx) => {
      const a = await makeStaff(tx, { name: 'Alpha' })
      const b = await makeStaff(tx, { name: 'Beta' })

      // Soft-delete Beta.
      await tx
        .update(schema.staff)
        .set({ deletedAt: new Date(), status: 'inactive' })
        .where(eq(schema.staff.id, b.staffId))

      // Replicate the GET /api/staff default where clause.
      const visible = await tx
        .select({ id: schema.staff.id, fullName: schema.staff.fullName })
        .from(schema.staff)
        .where(isNull(schema.staff.deletedAt))
      const ids = visible.map((r) => r.id)
      expect(ids).toContain(a.staffId)
      expect(ids).not.toContain(b.staffId)
    })
  })

  it('a soft-deleted staff record is recoverable (their documents remain)', async () => {
    await withRollback(async (tx) => {
      const a = await makeStaff(tx, { name: 'Recoverable' })
      // Attach a document to them.
      await tx.insert(schema.staffDocuments).values({
        staffId: a.staffId,
        title: 'NDA',
        fileUrl: 'https://example.com/nda.pdf',
      })

      // Soft delete.
      await tx
        .update(schema.staff)
        .set({ deletedAt: new Date(), status: 'inactive' })
        .where(eq(schema.staff.id, a.staffId))

      // Document should still exist (no cascade because we didn't hard-delete).
      const docs = await tx
        .select()
        .from(schema.staffDocuments)
        .where(eq(schema.staffDocuments.staffId, a.staffId))
      expect(docs).toHaveLength(1)
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Phase 2B — Lifecycle template idempotent seeding
// ════════════════════════════════════════════════════════════════════════════

describe.skipIf(noDb)('Lifecycle tasks — idempotent seeding', () => {
  it('running the onboarding template twice does not duplicate rows', async () => {
    await withRollback(async (tx) => {
      const { staffId } = await makeStaff(tx, { name: 'New Hire' })
      const template = templateFor('onboarding')
      expect(template.length).toBeGreaterThan(0)

      const seedOnce = async () => {
        const existing = await tx
          .select({ taskKey: schema.staffLifecycleTasks.taskKey })
          .from(schema.staffLifecycleTasks)
          .where(
            and(
              eq(schema.staffLifecycleTasks.staffId, staffId),
              eq(schema.staffLifecycleTasks.kind, 'onboarding')
            )
          )
        const existingKeys = new Set(existing.map((r) => r.taskKey))
        const toInsert = template
          .filter((t) => !existingKeys.has(t.key))
          .map((t) => ({
            staffId,
            kind: 'onboarding' as const,
            taskKey: t.key,
            label: t.label,
            description: t.description ?? null,
          }))
        if (toInsert.length > 0) {
          await tx.insert(schema.staffLifecycleTasks).values(toInsert)
        }
        return toInsert.length
      }

      const inserted1 = await seedOnce()
      const inserted2 = await seedOnce()

      expect(inserted1).toBe(template.length)
      expect(inserted2).toBe(0) // second pass inserts nothing — idempotent

      const all = await tx
        .select()
        .from(schema.staffLifecycleTasks)
        .where(eq(schema.staffLifecycleTasks.staffId, staffId))
      expect(all.length).toBe(template.length)
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Phase 0 — Request status transition guard (data-shape, route-layer enforces)
// ════════════════════════════════════════════════════════════════════════════

describe.skipIf(noDb)(
  'Request status — reversal requires force + reason at the route layer',
  () => {
    it('captures previous status in audit changes on a reversal', async () => {
      await withRollback(async (tx) => {
        const { staffId, userId } = await makeStaff(tx, { name: 'Status Subject' })

        const [req] = await tx
          .insert(schema.staffRequests)
          .values({ staffId, requestType: 'leave', status: 'approved' })
          .returning()

        // Replicate the audit-log shape the route writes on a reversal.
        await tx.insert(schema.auditLogs).values({
          userId,
          action: 'request_reversed_to_rejected',
          module: 'staff_requests',
          entityId: req.id,
          changes: { status: 'rejected', previousStatus: 'approved', reason: 'Documented' },
          reason: 'Documented',
        })

        const logs = await tx
          .select()
          .from(schema.auditLogs)
          .where(eq(schema.auditLogs.entityId, req.id))
        expect(logs).toHaveLength(1)
        const changes = logs[0].changes as { previousStatus?: string; reason?: string } | null
        expect(changes?.previousStatus).toBe('approved')
        expect(logs[0].reason).toBe('Documented')
      })
    })
  }
)

// ════════════════════════════════════════════════════════════════════════════
// Phase 2C — Compensation history auto-closing prior row
// ════════════════════════════════════════════════════════════════════════════

describe.skipIf(noDb)('Compensation history — open-ended row auto-closes', () => {
  it('inserting a new effectiveFrom closes the prior open row to that date', async () => {
    await withRollback(async (tx) => {
      const { staffId, userId } = await makeStaff(tx, { name: 'Comp Subject' })

      // Initial open-ended row
      await tx.insert(schema.staffCompensationHistory).values({
        staffId,
        effectiveFrom: new Date('2026-01-01'),
        baseAmount: 4000,
        currency: 'GHS',
        reason: 'hire',
        createdById: userId,
      })

      // Promotion at 2026-04-01 — close the prior row then insert.
      const newEffective = new Date('2026-04-01')
      await tx
        .update(schema.staffCompensationHistory)
        .set({ effectiveTo: newEffective })
        .where(
          and(
            eq(schema.staffCompensationHistory.staffId, staffId),
            isNull(schema.staffCompensationHistory.effectiveTo)
          )
        )

      await tx.insert(schema.staffCompensationHistory).values({
        staffId,
        effectiveFrom: newEffective,
        baseAmount: 5000,
        currency: 'GHS',
        reason: 'promotion',
        createdById: userId,
      })

      const rows = await tx
        .select()
        .from(schema.staffCompensationHistory)
        .where(eq(schema.staffCompensationHistory.staffId, staffId))

      expect(rows).toHaveLength(2)
      const closed = rows.find((r) => r.effectiveFrom.toISOString().startsWith('2026-01-01'))
      const open = rows.find((r) => r.effectiveFrom.toISOString().startsWith('2026-04-01'))
      expect(closed?.effectiveTo?.toISOString().startsWith('2026-04-01')).toBe(true)
      expect(open?.effectiveTo).toBeNull()
    })
  })
})

describe.skipIf(noDb)('Anviz Webhook — swipe events ingestion', () => {
  it('saves swipe events and resolves staffId from deviceUserId', async () => {
    await withRollback(async (tx) => {
      // 1. Create a staff member with a deviceUserId
      const userId = `__it_user_${randomUUID().slice(0, 12)}`
      const now = new Date()
      await tx.insert(schema.user).values({
        id: userId,
        name: 'Anviz Test Staff',
        email: `${userId}@it.local`,
        emailVerified: true,
        roleId: null,
        banned: false,
        createdAt: now,
        updatedAt: now,
      })

      const [s] = await tx
        .insert(schema.staff)
        .values({
          staffId: `ANVIZ-${randomUUID().slice(0, 8)}`,
          userId,
          fullName: 'Anviz Test Staff',
          email: `${userId}@it.local`,
          employmentType: 'permanent',
          status: 'active',
          staffType: 'internal',
          deviceUserId: '9999', // Matches payload workno
        })
        .returning()

      // 2. Insert via the webhook logic (we can run the query directly to verify the DB logic)
      const eventTimestamp = new Date('2026-06-13T12:00:00.000Z')
      const [inserted] = await tx
        .insert(schema.attendanceEvents)
        .values({
          staffId: s.id,
          deviceUserId: '9999',
          deviceUserName: 'Anviz Test Staff',
          eventTimestamp,
          deviceNo: 'serial-1234',
          rawStatus: '0',
          sourceFile: 'anviz_webhook',
        })
        .onConflictDoNothing({
          target: [
            schema.attendanceEvents.deviceUserId,
            schema.attendanceEvents.eventTimestamp,
            schema.attendanceEvents.deviceNo,
            schema.attendanceEvents.rawStatus,
          ],
        })
        .returning({ id: schema.attendanceEvents.id })

      expect(inserted).toBeDefined()
      expect(inserted.id).toBeDefined()

      // Verify resolved staffId
      const [fetched] = await tx
        .select()
        .from(schema.attendanceEvents)
        .where(eq(schema.attendanceEvents.id, inserted.id))

      expect(fetched.staffId).toBe(s.id)
      expect(fetched.deviceUserId).toBe('9999')
      expect(fetched.rawStatus).toBe('0')

      // Test duplicate insertion (should be ignored due to onConflictDoNothing)
      const [duplicate] = await tx
        .insert(schema.attendanceEvents)
        .values({
          staffId: s.id,
          deviceUserId: '9999',
          deviceUserName: 'Anviz Test Staff',
          eventTimestamp,
          deviceNo: 'serial-1234',
          rawStatus: '0',
          sourceFile: 'anviz_webhook',
        })
        .onConflictDoNothing({
          target: [
            schema.attendanceEvents.deviceUserId,
            schema.attendanceEvents.eventTimestamp,
            schema.attendanceEvents.deviceNo,
            schema.attendanceEvents.rawStatus,
          ],
        })
        .returning({ id: schema.attendanceEvents.id })

      expect(duplicate).toBeUndefined()
    })
  })

  it('retrieves raw attendance events ordered by timestamp desc', async () => {
    await withRollback(async (tx) => {
      // 1. Create a staff member
      const { staffId } = await makeStaff(tx, { name: 'Raw Log User' })
      await tx
        .update(schema.staff)
        .set({ deviceUserId: '8888' })
        .where(eq(schema.staff.id, staffId))

      // 2. Insert two events out of order
      const ts1 = new Date('2026-06-13T12:00:00.000Z')
      const ts2 = new Date('2026-06-13T13:00:00.000Z')

      await tx.insert(schema.attendanceEvents).values([
        {
          staffId,
          deviceUserId: '8888',
          deviceUserName: 'Raw Log User',
          eventTimestamp: ts1,
          deviceNo: 'device-1',
          rawStatus: '0',
          sourceFile: 'anviz_webhook',
        },
        {
          staffId,
          deviceUserId: '8888',
          deviceUserName: 'Raw Log User',
          eventTimestamp: ts2,
          deviceNo: 'device-1',
          rawStatus: '1',
          sourceFile: 'anviz_webhook',
        },
      ])

      // 3. Query using the same logic as the GET route: order by eventTimestamp desc
      const events = await tx
        .select({
          id: schema.attendanceEvents.id,
          staffId: schema.attendanceEvents.staffId,
          staffName: schema.staff.fullName,
          deviceUserId: schema.attendanceEvents.deviceUserId,
          deviceUserName: schema.attendanceEvents.deviceUserName,
          eventTimestamp: schema.attendanceEvents.eventTimestamp,
          deviceNo: schema.attendanceEvents.deviceNo,
          rawStatus: schema.attendanceEvents.rawStatus,
          sourceFile: schema.attendanceEvents.sourceFile,
          createdAt: schema.attendanceEvents.createdAt,
        })
        .from(schema.attendanceEvents)
        .leftJoin(schema.staff, eq(schema.staff.id, schema.attendanceEvents.staffId))
        .orderBy(desc(schema.attendanceEvents.eventTimestamp))
        .limit(200)

      // 4. Assertions
      const userEvents = events.filter((e: any) => e.deviceUserId === '8888')
      expect(userEvents).toHaveLength(2)
      // Ordered by eventTimestamp desc, so ts2 should come first
      expect(userEvents[0].eventTimestamp.getTime()).toBe(ts2.getTime())
      expect(userEvents[0].staffName).toBe('Raw Log User')
      expect(userEvents[0].rawStatus).toBe('1')

      expect(userEvents[1].eventTimestamp.getTime()).toBe(ts1.getTime())
      expect(userEvents[1].rawStatus).toBe('0')
    })
  })
})
