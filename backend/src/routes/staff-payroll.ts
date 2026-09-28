import { canSelfServiceApply, PAYROLL_SENSITIVE_FIELDS, updateStaffSchema } from '@denel/types'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { payrollRuns, payslips, staff, staffProfileChangeRequests, user } from '../db/schema'
import { createAuditLog } from '../lib/audit'
import { ACTIONS, MODULES } from '../lib/modules'
import { handleGetSinglePayslipPdf } from '../lib/pdf-handlers'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'
import { formatPhoneNumber } from '../lib/utils/phone'

const app = new Hono<HonoEnv>()

const MODULE = MODULES.STAFF

// ---------------------------------------------------------------------------
// Payslips (admin)
// ---------------------------------------------------------------------------

/** List all payslips (admin) */
app.get('/payslips', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.PAYROLL as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const { staffId: filterStaffId, month } = c.req.query()

    const conditions = []
    if (filterStaffId) conditions.push(eq(payslips.staffId, filterStaffId))
    if (month) conditions.push(sql`DATE_TRUNC('month', ${payslips.payPeriod}) = ${month}::date`)

    const rows = await db
      .select({
        id: payslips.id,
        staffId: payslips.staffId,
        staffName: staff.fullName,
        staffCode: staff.staffId,
        payPeriod: payslips.payPeriod,
        grossPay: payslips.grossPay,
        netPay: payslips.netPay,
        status: payslips.status,
        publishedAt: payslips.publishedAt,
        fileUrl: payslips.fileUrl,
        payrollRunId: payslips.payrollRunId,
        createdAt: payslips.createdAt,
      })
      .from(payslips)
      .leftJoin(staff, eq(payslips.staffId, staff.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(payslips.payPeriod), asc(staff.fullName))

    return c.json({ success: true, data: rows })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to fetch payslips' }, 500)
  }
})

/** Create payslip (admin) */
app.post('/payslips', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.PAYROLL as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const body = await c.req.json()
    const { staffId, payPeriod, grossPay, netPay, deductions, fileUrl } = body
    if (!staffId || !payPeriod) return c.json({ error: 'staffId and payPeriod required' }, 400)

    const db = getDb(process.env.DATABASE_URL!)

    // HR-H1: never overwrite a payslip once it (or its parent run) is published —
    // the payroll GL was posted from those figures, and this upsert performs no
    // reversal. A legitimate correction must go through an explicit
    // reverse-and-repost flow. Block here so the books and payslips can't diverge.
    const existingSlip = await db.query.payslips.findFirst({
      where: and(eq(payslips.staffId, staffId), eq(payslips.payPeriod, payPeriod)),
      columns: { status: true, payrollRunId: true },
    })
    if (existingSlip) {
      if (existingSlip.status === 'published') {
        return c.json(
          {
            error: 'Payslip is published — reverse the payroll run before editing.',
            code: 'PAYSLIP_LOCKED',
          },
          409
        )
      }
      if (existingSlip.payrollRunId) {
        const run = await db.query.payrollRuns.findFirst({
          where: eq(payrollRuns.id, existingSlip.payrollRunId),
          columns: { status: true },
        })
        if (run && (run.status === 'published' || run.status === 'locked')) {
          return c.json(
            {
              error: 'Parent payroll run is published/locked — reverse it before editing.',
              code: 'PAYSLIP_LOCKED',
            },
            409
          )
        }
      }
    }

    const [created] = await db
      .insert(payslips)
      .values({
        staffId,
        payPeriod,
        grossPay: grossPay ?? null,
        netPay: netPay ?? null,
        deductions: deductions ?? null,
        fileUrl: fileUrl ?? null,
        status: 'draft',
        uploadedById: authUser.id,
      })
      .onConflictDoUpdate({
        target: [payslips.staffId, payslips.payPeriod],
        set: {
          grossPay: grossPay ?? null,
          netPay: netPay ?? null,
          deductions: deductions ?? null,
          fileUrl: fileUrl ?? null,
          uploadedById: authUser.id,
          updatedAt: new Date(),
        },
      })
      .returning()

    return c.json({ success: true, data: created })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to create payslip' }, 500)
  }
})

/** Publish payslip (admin) */
app.patch('/payslips/:id/publish', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.PAYROLL as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const id = c.req.param('id')
    const db = getDb(process.env.DATABASE_URL!)
    const existing = await db.query.payslips.findFirst({ where: eq(payslips.id, id) })
    if (!existing) return c.json({ error: 'Payslip not found' }, 404)

    const [updated] = await db
      .update(payslips)
      .set({ status: 'published', publishedAt: new Date(), updatedAt: new Date() })
      .where(eq(payslips.id, id))
      .returning()

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: authUser.id,
      action: 'payslip_published',
      module: 'payroll',
      entityId: id,
      entityName: `Payslip ${updated.payPeriod}`,
      beforeJson: { status: existing.status, publishedAt: existing.publishedAt },
      afterJson: { status: updated.status, publishedAt: updated.publishedAt },
      changes: {
        staffId: updated.staffId,
        payPeriod: updated.payPeriod,
        grossPay: updated.grossPay,
        netPay: updated.netPay,
      },
    })

    return c.json({ success: true, data: updated })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to publish payslip' }, 500)
  }
})

/** Unpublish / revert payslip to draft (admin) */
app.patch('/payslips/:id/unpublish', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.PAYROLL as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const id = c.req.param('id')
    const db = getDb(process.env.DATABASE_URL!)
    const existing = await db.query.payslips.findFirst({ where: eq(payslips.id, id) })
    if (!existing) return c.json({ error: 'Payslip not found' }, 404)

    // HR-H1: refuse to revert a payslip to draft once its parent run has been
    // posted to the GL (run status published/locked) — there is no reversal here,
    // so unpublishing would silently desync the books from the payslips.
    if (existing.payrollRunId) {
      const run = await db.query.payrollRuns.findFirst({
        where: eq(payrollRuns.id, existing.payrollRunId),
        columns: { status: true },
      })
      if (run && (run.status === 'published' || run.status === 'locked')) {
        return c.json(
          {
            error: 'Parent payroll run is published/locked — reverse the run before unpublishing.',
            code: 'PAYSLIP_LOCKED',
          },
          409
        )
      }
    }

    const [updated] = await db
      .update(payslips)
      .set({ status: 'draft', publishedAt: null, updatedAt: new Date() })
      .where(eq(payslips.id, id))
      .returning()

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: authUser.id,
      action: 'payslip_unpublished',
      module: 'payroll',
      entityId: id,
      entityName: `Payslip ${updated.payPeriod}`,
      beforeJson: { status: existing.status, publishedAt: existing.publishedAt },
      afterJson: { status: updated.status, publishedAt: null },
    })

    return c.json({ success: true, data: updated })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to unpublish payslip' }, 500)
  }
})

/** Delete payslip (admin, draft only) */
app.delete('/payslips/:id', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.PAYROLL as string, ACTIONS.DELETE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const id = c.req.param('id')
    const db = getDb(process.env.DATABASE_URL!)
    const existing = await db.query.payslips.findFirst({ where: eq(payslips.id, id) })
    if (!existing) return c.json({ error: 'Payslip not found' }, 404)

    // Only draft (not yet published) or suspended (unlinked from its run)
    // payslips can be deleted. A published payslip is locked — staff can see it.
    const deleted = await db
      .delete(payslips)
      .where(and(eq(payslips.id, id), inArray(payslips.status, ['draft', 'suspended'])))
      .returning()

    if (deleted.length === 0) {
      return c.json(
        {
          error: 'Only draft or unlinked payslips can be deleted. Unlink it from its run first.',
          code: 'PAYSLIP_LOCKED',
        },
        409
      )
    }

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: authUser.id,
      action: 'payslip_deleted',
      module: 'payroll',
      entityId: id,
      entityName: `Payslip ${existing.payPeriod}`,
      beforeJson: { status: existing.status, payPeriod: existing.payPeriod },
    })
    return c.json({ success: true })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to delete payslip' }, 500)
  }
})

// ---------------------------------------------------------------------------
// Profile Change Requests (admin review)
// ---------------------------------------------------------------------------

/** List profile change requests (admin) */
app.get('/profile-change-requests', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const { status: filterStatus } = c.req.query()

    const conditions = filterStatus ? [eq(staffProfileChangeRequests.status, filterStatus)] : []

    const rows = await db
      .select({
        id: staffProfileChangeRequests.id,
        staffId: staffProfileChangeRequests.staffId,
        staffName: staff.fullName,
        staffCode: staff.staffId,
        changeType: staffProfileChangeRequests.changeType,
        requestedData: staffProfileChangeRequests.requestedData,
        status: staffProfileChangeRequests.status,
        reviewComments: staffProfileChangeRequests.reviewComments,
        reviewedAt: staffProfileChangeRequests.reviewedAt,
        submittedAt: staffProfileChangeRequests.submittedAt,
      })
      .from(staffProfileChangeRequests)
      .leftJoin(staff, eq(staffProfileChangeRequests.staffId, staff.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(staffProfileChangeRequests.submittedAt))

    return c.json({ success: true, data: rows })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to fetch change requests' }, 500)
  }
})

/** Review (approve/reject) a profile change request (admin) */
app.patch('/profile-change-requests/:id', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const id = c.req.param('id')
    const body = await c.req.json()
    const { status, reviewComments } = body

    if (!['approved', 'rejected'].includes(status))
      return c.json({ error: 'status must be approved or rejected' }, 400)

    const db = getDb(process.env.DATABASE_URL!)

    const [request] = await db
      .select()
      .from(staffProfileChangeRequests)
      .where(eq(staffProfileChangeRequests.id, id))
      .limit(1)

    if (!request) return c.json({ error: 'Request not found' }, 404)

    // Status-transition guard — same rule as request review. Once decided,
    // require an explicit reversal with a reason.
    const isReversal = request.status !== 'pending' && request.status !== status
    if (isReversal && !body.force) {
      return c.json(
        {
          error: `Request is already ${request.status}. Pass force=true with a reason to reverse.`,
          code: 'STATUS_TRANSITION_BLOCKED',
        },
        409
      )
    }
    if (isReversal && body.force && !body.reason) {
      return c.json({ error: 'reason is required when reversing a decision' }, 400)
    }

    // Auto-apply simple field changes on approval. Run BEFORE the request
    // status is flipped so an upstream uniqueness violation (e.g. email
    // collision) doesn't leave a request marked approved with no underlying
    // change applied.
    let appliedFieldChange: { field: string; previousValue: unknown } | null = null
    if (status === 'approved') {
      const data = request.requestedData as any
      if (data?.field && data?.requestedValue !== undefined && data?.requestedValue !== null) {
        // Refuse to "approve" something we can't actually write. The old
        // handler had a 4-field allowlist and silently fell through for
        // anything else: the request flipped to approved, nothing was written,
        // and HR believed they'd actioned a change that never happened.
        if (!canSelfServiceApply(request.changeType, data.field)) {
          return c.json(
            {
              error: `“${data.field}” can't be auto-applied from a ${request.changeType} request. Apply it from the staff profile, then reject this request with a note.`,
              code: 'CHANGE_NOT_AUTO_APPLIABLE',
            },
            422
          )
        }

        // Bank/tax edits are payroll-tier wherever they happen (HR-L9). An
        // approver with staff:update but not payroll:update must not be able to
        // rewrite banking details just because a staffer asked them to.
        if (
          PAYROLL_SENSITIVE_FIELDS.includes(data.field) &&
          !(await checkPermission(
            c,
            authUser.id,
            MODULES.PAYROLL as string,
            ACTIONS.UPDATE as string
          ))
        ) {
          return c.json(
            {
              error:
                'Approving a change to payout or tax details requires the payroll:update permission.',
              code: 'PAYROLL_PERMISSION_REQUIRED',
            },
            403
          )
        }

        // Validate the value against the canonical column contract, so an
        // approval can't write something the staff editor would have rejected.
        const shape = updateStaffSchema.safeParse({ [data.field]: data.requestedValue })
        if (!shape.success) {
          const first = shape.error.issues[0]
          return c.json(
            { error: `Requested value is not valid: ${first?.message ?? 'invalid'}` },
            400
          )
        }

        {
          const staffRecord = await db.query.staff.findFirst({
            where: eq(staff.id, request.staffId),
            columns: { id: true, userId: true, email: true, phone: true, fullName: true },
          })
          if (!staffRecord) return c.json({ error: 'Staff record not found' }, 404)

          // Email changes mutate user.email (login identifier) — enforce
          // uniqueness explicitly so a colliding email doesn't fall through
          // the DB unique constraint after the request is already approved.
          if (data.field === 'email') {
            const newEmail = String(data.requestedValue).trim().toLowerCase()
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
              return c.json({ error: 'Requested email is not valid' }, 400)
            }
            const existingByEmail = await db.query.user.findFirst({
              where: eq(user.email, newEmail),
              columns: { id: true },
            })
            if (existingByEmail && existingByEmail.id !== staffRecord.userId) {
              return c.json({ error: 'Another account already uses this email' }, 409)
            }
            if (staffRecord.userId) {
              await db
                .update(user)
                .set({ email: newEmail, updatedAt: new Date() })
                .where(eq(user.id, staffRecord.userId))
            }
            appliedFieldChange = { field: 'email', previousValue: staffRecord.email }
            await db.update(staff).set({ email: newEmail }).where(eq(staff.id, request.staffId))
          } else if (data.field === 'phone') {
            // Phone is the passwordless-OTP login identifier — mirror the email
            // branch: enforce staff-phone uniqueness (the staff editor does the
            // same at staff-core.ts) and sync user.phone so login doesn't desync
            // from the displayed number after an approved change.
            const newPhone = formatPhoneNumber(String(data.requestedValue))
            if (newPhone && newPhone !== formatPhoneNumber(staffRecord.phone)) {
              const actives = await db
                .select({ id: staff.id, fullName: staff.fullName, phone: staff.phone })
                .from(staff)
                .where(isNull(staff.deletedAt))
              const clash = actives.find(
                (s) => s.id !== staffRecord.id && formatPhoneNumber(s.phone) === newPhone
              )
              if (clash) {
                return c.json(
                  {
                    error: `Phone number is already assigned to another staff (${clash.fullName}).`,
                  },
                  409
                )
              }
            }
            if (staffRecord.userId) {
              await db
                .update(user)
                .set({ phone: newPhone || null, updatedAt: new Date() })
                .where(eq(user.id, staffRecord.userId))
            }
            appliedFieldChange = { field: 'phone', previousValue: staffRecord.phone }
            await db
              .update(staff)
              .set({ phone: newPhone || data.requestedValue })
              .where(eq(staff.id, request.staffId))
          } else {
            appliedFieldChange = {
              field: data.field,
              previousValue: (staffRecord as any)[data.field] ?? null,
            }
            await db
              .update(staff)
              .set({ [data.field]: data.requestedValue })
              .where(eq(staff.id, request.staffId))
          }
        }
      }
    }

    const [updated] = await db
      .update(staffProfileChangeRequests)
      .set({
        status,
        reviewComments: reviewComments ?? null,
        reviewedById: authUser.id,
        reviewedAt: new Date(),
      })
      .where(eq(staffProfileChangeRequests.id, id))
      .returning()

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: authUser.id,
      action: isReversal ? `profile_change_reversed_to_${status}` : `profile_change_${status}`,
      module: 'staff',
      entityId: request.staffId,
      entityName: `Profile change request`,
      beforeJson: {
        requestStatus: request.status,
        ...(appliedFieldChange
          ? { [appliedFieldChange.field]: appliedFieldChange.previousValue }
          : {}),
      },
      afterJson: {
        requestStatus: status,
        ...(appliedFieldChange
          ? { [appliedFieldChange.field]: (request.requestedData as any).requestedValue }
          : {}),
      },
      reason: isReversal ? body.reason : null,
    })

    return c.json({ success: true, data: updated })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to update change request' }, 500)
  }
})

export { app as staffPayrollApp }

app.get('/payslips/:id/pdf', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.PAYROLL as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  return handleGetSinglePayslipPdf(c, id)
})
