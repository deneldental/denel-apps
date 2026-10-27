import { canSelfServiceApply, profileChangeRequestSchema } from '@denel/types'
import { zValidator } from '@hono/zod-validator'
import { and, asc, count, desc, eq, gt, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db'
import {
  breakfastAcknowledgements,
  breakfastSubmissionItems,
  breakfastSubmissions,
  clinicSettings,
  documentAccessLogs,
  items,
  payrollRuns,
  payslips,
  performanceScores,
  salaryComponents,
  staff,
  staffAttendance,
  staffAttendanceSubmissions,
  staffDocuments,
  staffMemoAcknowledgements,
  staffMemos,
  staffProfileChangeRequests,
  staffQuestionnaireQuestions,
  staffQuestionnaireResponses,
  staffQuestionnaires,
  staffRequests,
  staffTrainingProgress,
  stockMovements,
  taskAssignments,
  trainingAttempts,
  trainingMaterials,
  user,
} from '../db/schema'
import { getCredentialHash, setUserPassword } from '../lib/account-sessions'
import { getBranding } from '../lib/branding'
import { buildEmployeeDataSheetHtml } from '../lib/employee-data-sheet'
import { logError } from '../lib/logger'
import { memoTargetsStaff } from '../lib/memo-audience'
import { clearPasswordChange } from '../lib/password-change'
import { checkPasswordPolicy, isSameAsCurrent } from '../lib/password-policy'
import { handleGetSinglePayslipPdf } from '../lib/pdf-handlers'
import { renderHtmlToPdf } from '../lib/pdf-render'
import { sendPushToUsers } from '../lib/push'
import { getCurrentUser } from '../lib/rbac'
import { OTP_GENERIC_ERROR, requestStaffOtp, verifyStaffOtp } from '../lib/staff-otp'
import { revokeAllStaffDevices } from '../lib/staff-trusted-device'
import { uploadToCategory } from '../lib/storage-router'
import type { HonoEnv } from '../lib/types'
import { uploadProfiles, validateUpload } from '../lib/upload-validation'
import {
  computeLeaveBalanceInternal,
  emptyDayRecord,
  fetchDailySummariesForStaffRange,
  formatYMD,
  startOfWeekMonUtc,
  weekLabel,
} from './staff-attendance'

const staffPortalApp = new Hono<HonoEnv>()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the staff record for the currently authenticated user */
async function getStaffForUser(c: any) {
  const authUser = await getCurrentUser(c)
  if (!authUser) return null

  const db = getDb(process.env.DATABASE_URL!)
  const staffMember = await db.query.staff.findFirst({
    where: eq(staff.userId, authUser.id),
  })
  if (!staffMember) return null
  // Project the auth user's role onto the staff record so callers that used to
  // Use RBAC roleId ('receptionist', 'doctor', etc.) over the Better Auth role field ('user').
  return { ...staffMember, role: authUser.roleId ?? authUser.role ?? null }
}

// ---------------------------------------------------------------------------
// Dashboard — Quick Stats for the logged-in staff member
// ---------------------------------------------------------------------------
staffPortalApp.get('/dashboard', async (c) => {
  const staffMember = await getStaffForUser(c)
  if (!staffMember) return c.json({ error: 'Not authenticated or no staff profile' }, 401)

  const db = getDb(process.env.DATABASE_URL!)

  try {
    // Pending requests count
    const [pendingRequests] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(staffRequests)
      .where(and(eq(staffRequests.staffId, staffMember.id), eq(staffRequests.status, 'pending')))

    // New documents (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const [newDocuments] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(staffDocuments)
      .where(
        and(
          eq(staffDocuments.staffId, staffMember.id),
          gt(staffDocuments.uploadedAt, thirtyDaysAgo)
        )
      )

    // Assigned training count (not completed)
    const [pendingTraining] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(staffTrainingProgress)
      .where(
        and(
          eq(staffTrainingProgress.staffId, staffMember.id),
          sql`${staffTrainingProgress.status} != 'completed'`
        )
      )

    // Latest performance score
    const latestScore = await db.query.performanceScores.findFirst({
      where: eq(performanceScores.staffId, staffMember.id),
      orderBy: [desc(performanceScores.evaluatedAt)],
    })

    // Unacknowledged published memos targeting this staff (badge count) — same
    // audience + acknowledgement logic as GET /memos.
    const publishedMemos = await db.query.staffMemos.findMany({
      where: eq(staffMemos.published, true),
      columns: { id: true, audienceFilter: true },
    })
    const myRoleId = await getMyRoleId(db, staffMember.userId)
    const visibleMemoIds = publishedMemos
      .filter((m) =>
        memoTargetsStaff(m.audienceFilter, { staffId: staffMember.id, roleId: myRoleId })
      )
      .map((m) => m.id)
    let newMemos = 0
    if (visibleMemoIds.length > 0) {
      const acks = await db
        .select({ memoId: staffMemoAcknowledgements.memoId })
        .from(staffMemoAcknowledgements)
        .where(
          and(
            eq(staffMemoAcknowledgements.staffId, staffMember.id),
            inArray(staffMemoAcknowledgements.memoId, visibleMemoIds)
          )
        )
      newMemos = visibleMemoIds.length - acks.length
    }

    // Pending (not-done) task assignments for this staff or their linked user.
    const taskConds = [eq(taskAssignments.staffId, staffMember.id)]
    if (staffMember.userId) taskConds.push(eq(taskAssignments.userId, staffMember.userId))
    const [pendingTasks] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(taskAssignments)
      .where(and(or(...taskConds), sql`${taskAssignments.status} != 'done'`))

    // Assigned assessments (training items that carry a quiz) not yet completed.
    const [pendingAssessments] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(staffTrainingProgress)
      .innerJoin(trainingMaterials, eq(staffTrainingProgress.trainingId, trainingMaterials.id))
      .where(
        and(
          eq(staffTrainingProgress.staffId, staffMember.id),
          sql`${staffTrainingProgress.status} != 'completed'`,
          sql`jsonb_array_length(coalesce(${trainingMaterials.quizQuestions}, '[]'::jsonb)) > 0`
        )
      )

    return c.json({
      success: true,
      data: {
        staff: {
          id: staffMember.id,
          staffId: staffMember.staffId,
          fullName: staffMember.fullName,
          role: staffMember.role,
          position: staffMember.position,
          profileImage: staffMember.profileImage,
          isExternalTrainer: staffMember.isExternalTrainer,
        },
        stats: {
          pendingRequests: pendingRequests?.count ?? 0,
          newDocuments: newDocuments?.count ?? 0,
          pendingTraining: pendingTraining?.count ?? 0,
          latestPerformanceScore: latestScore?.score ?? null,
          newMemos,
          pendingTasks: pendingTasks?.count ?? 0,
          pendingAssessments: pendingAssessments?.count ?? 0,
        },
      },
    })
  } catch (error: unknown) {
    logError(error, { context: '[staff-portal] Dashboard error' })
    return c.json({ error: 'Failed to load dashboard' }, 500)
  }
})

// ---------------------------------------------------------------------------
// Memos — Published announcements
// ---------------------------------------------------------------------------

staffPortalApp.get('/memos', async (c) => {
  const staffMember = await getStaffForUser(c)
  if (!staffMember) return c.json({ error: 'Not authenticated' }, 401)

  const db = getDb(process.env.DATABASE_URL!)
  const typeFilter = c.req.query('type') // optional: 'announcement' | 'notice' | 'meeting_memo' | 'general'

  try {
    const where = typeFilter
      ? and(eq(staffMemos.published, true), eq(staffMemos.memoType, typeFilter))
      : eq(staffMemos.published, true)
    const allPublished = await db.query.staffMemos.findMany({
      where,
      orderBy: [desc(staffMemos.createdAt)],
    })

    // Filter to memos targeted at this staff member. Empty filter = broadcast.
    const myRoleId = await getMyRoleId(db, staffMember.userId)
    const visible = allPublished.filter((memo) =>
      memoTargetsStaff(memo.audienceFilter, {
        staffId: staffMember.id,
        roleId: myRoleId,
      })
    )

    // Annotate each memo with whether this staff has acknowledged it.
    const memoIds = visible.map((m) => m.id)
    const myAcks =
      memoIds.length === 0
        ? []
        : await db
            .select({ memoId: staffMemoAcknowledgements.memoId })
            .from(staffMemoAcknowledgements)
            .where(
              and(
                eq(staffMemoAcknowledgements.staffId, staffMember.id),
                inArray(staffMemoAcknowledgements.memoId, memoIds)
              )
            )
    const ackSet = new Set(myAcks.map((a) => a.memoId))

    const annotated = visible.map((memo) => ({
      ...memo,
      acknowledged: ackSet.has(memo.id),
    }))

    return c.json({ success: true, data: annotated })
  } catch (error: unknown) {
    logError(error, { context: '[staff-portal] GET /memos error' })
    return c.json({ error: 'Failed to fetch memos' }, 500)
  }
})

/**
 * POST /memos/:id/acknowledge — staff opens a memo on the PWA. Idempotent —
 * subsequent calls are no-ops via the unique index on (memoId, staffId).
 */
staffPortalApp.post('/memos/:id/acknowledge', async (c) => {
  const staffMember = await getStaffForUser(c)
  if (!staffMember) return c.json({ error: 'Not authenticated' }, 401)

  const db = getDb(process.env.DATABASE_URL!)
  const memoId = c.req.param('id')

  try {
    // Verify the memo exists and is targeted at this staff member — refuse
    // to record an ack for a memo they shouldn't see.
    const memo = await db.query.staffMemos.findFirst({
      where: and(eq(staffMemos.id, memoId), eq(staffMemos.published, true)),
    })
    if (!memo) return c.json({ error: 'Memo not found' }, 404)

    const myRoleId = await getMyRoleId(db, staffMember.userId)
    const inAudience = memoTargetsStaff(memo.audienceFilter, {
      staffId: staffMember.id,
      roleId: myRoleId,
    })
    if (!inAudience) return c.json({ error: 'Memo is not addressed to you' }, 403)

    await db
      .insert(staffMemoAcknowledgements)
      .values({ memoId, staffId: staffMember.id, acknowledgedAt: new Date() })
      .onConflictDoNothing({
        target: [staffMemoAcknowledgements.memoId, staffMemoAcknowledgements.staffId],
      })

    return c.json({ success: true })
  } catch (error: unknown) {
    logError(error, { context: '[staff-portal] POST /memos/:id/acknowledge error' })
    return c.json({ error: 'Failed to record acknowledgement' }, 500)
  }
})

// ── Audience helpers ────────────────────────────────────────────────────────
// `memoTargetsStaff` is exported from backend/src/lib/memo-audience.ts so
// portal + PWA share the same predicate and it's unit-testable.

async function getMyRoleId(
  db: ReturnType<typeof getDb>,
  userId: string | null
): Promise<string | null> {
  if (!userId) return null
  const row = await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: { roleId: true },
  })
  return row?.roleId ?? null
}

// ---------------------------------------------------------------------------
// Requests — Submit & List
// ---------------------------------------------------------------------------

/** List own requests */
staffPortalApp.get('/requests', async (c) => {
  const staffMember = await getStaffForUser(c)
  if (!staffMember) return c.json({ error: 'Not authenticated' }, 401)

  const db = getDb(process.env.DATABASE_URL!)

  try {
    const data = await db.query.staffRequests.findMany({
      where: eq(staffRequests.staffId, staffMember.id),
      orderBy: [desc(staffRequests.createdAt)],
    })
    return c.json({ success: true, data })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to fetch requests' }, 500)
  }
})

/** Own annual-leave balance, incl. the bulk/casual split (Phase 5). */
staffPortalApp.get('/leave-balance', async (c) => {
  const staffMember = await getStaffForUser(c)
  if (!staffMember) return c.json({ error: 'Not authenticated' }, 401)

  const db = getDb(process.env.DATABASE_URL!)
  const yearStr = c.req.query('year')
  const parsedYear = yearStr ? Number(yearStr) : Number.NaN
  const year =
    Number.isInteger(parsedYear) && parsedYear >= 2000 && parsedYear <= 2100
      ? parsedYear
      : new Date().getUTCFullYear()

  try {
    const {
      offDaysSet: _o,
      holidaysSet: _h,
      ...balance
    } = await computeLeaveBalanceInternal(db, staffMember.id, year)
    void _o
    void _h
    return c.json({ success: true, data: balance })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to compute leave balance' }, 500)
  }
})

/** Submit a new request */
staffPortalApp.post('/requests', async (c) => {
  const staffMember = await getStaffForUser(c)
  if (!staffMember) return c.json({ error: 'Not authenticated' }, 401)

  // External trainers cannot submit requests
  if (staffMember.isExternalTrainer) {
    return c.json({ error: 'External trainers cannot submit requests' }, 403)
  }

  try {
    const body = await c.req.json()
    const db = getDb(process.env.DATABASE_URL!)

    const [newRequest] = await db
      .insert(staffRequests)
      .values({
        staffId: staffMember.id,
        requestType: body.requestType,
        subType: body.subType,
        description: body.description,
        reason: body.reason,
        startDate: body.startDate ? new Date(body.startDate) : null,
        endDate: body.endDate ? new Date(body.endDate) : null,
        amount: body.amount,
        urgencyLevel: body.urgencyLevel || 'normal',
        attachments: body.attachments || [],
      })
      .returning()

    return c.json({ success: true, data: newRequest })
  } catch (error: unknown) {
    logError(error, { context: '[staff-portal] Request submit error' })
    return c.json({ error: 'Failed to submit request' }, 500)
  }
})

// POST /api/staff-portal/avatar — staff self-service profile photo. The storage
// key is derived from the SESSION staff id, so a staff member can only ever
// write their OWN avatar. Sets profileImage atomically and returns the URL.
staffPortalApp.post('/avatar', async (c) => {
  const staffMember = await getStaffForUser(c)
  if (!staffMember) return c.json({ error: 'Not authenticated' }, 401)
  try {
    const formData = await c.req.formData()
    const file = formData.get('file') as File | null
    if (!file) return c.json({ error: 'Missing file' }, 400)

    const validation = await validateUpload(file, uploadProfiles.image)
    if (!validation.ok) return c.json({ error: validation.error }, 400)

    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
    const key = `staff/${staffMember.id}/avatar/${Date.now()}.${ext}`
    const result = await uploadToCategory(
      'staff',
      key,
      Buffer.from(validation.buffer as ArrayBuffer),
      file.type
    )

    const db = getDb(process.env.DATABASE_URL!)
    await db
      .update(staff)
      .set({ profileImage: result.url, updatedAt: new Date() })
      .where(eq(staff.id, staffMember.id))

    // Also sync the Better Auth user.image so surfaces that read it (e.g. the
    // doctor profile page) reflect the new avatar after a reload — otherwise the
    // upload only lands on staff.profileImage and user.image stays null.
    if (staffMember.userId) {
      await db
        .update(user)
        .set({ image: result.url, updatedAt: new Date() })
        .where(eq(user.id, staffMember.userId))
    }

    return c.json({ success: true, url: result.url })
  } catch (error) {
    logError(error, { context: '[staff-portal] avatar upload', staffId: staffMember.id })
    return c.json({ error: 'Failed to upload photo' }, 500)
  }
})

// ── Weekly breakfast ──────────────────────────────────────────────────────────
const BREAKFAST_NOTIFY_KEY = 'hr.breakfast_notifications_enabled'

/** Monday (UTC) of the week containing `d`, as YYYY-MM-DD. */
function mondayOf(d: Date): string {
  const x = new Date(d)
  x.setUTCHours(0, 0, 0, 0)
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7))
  return x.toISOString().slice(0, 10)
}

/** Breakfast notifications default ON unless explicitly disabled in settings. */
async function breakfastNotificationsEnabled(db: ReturnType<typeof getDb>): Promise<boolean> {
  const [row] = await db
    .select({ value: clinicSettings.value })
    .from(clinicSettings)
    .where(eq(clinicSettings.key, BREAKFAST_NOTIFY_KEY))
    .limit(1)
  const v = row?.value as { enabled?: boolean } | undefined
  return v?.enabled !== false
}

// GET /api/staff-portal/breakfast — latest weekly submission + this staff's
// receipt state. Breakfast lead also gets the breakfast inventory for the picker.
staffPortalApp.get('/breakfast', async (c) => {
  const staffMember = await getStaffForUser(c)
  if (!staffMember) return c.json({ error: 'Not authenticated' }, 401)
  const db = getDb(process.env.DATABASE_URL!)

  const [sub] = await db
    .select()
    .from(breakfastSubmissions)
    .orderBy(desc(breakfastSubmissions.weekStart))
    .limit(1)

  let submission = null
  if (sub) {
    const [its, acks, totals] = await Promise.all([
      db
        .select()
        .from(breakfastSubmissionItems)
        .where(eq(breakfastSubmissionItems.submissionId, sub.id)),
      db
        .select()
        .from(breakfastAcknowledgements)
        .where(eq(breakfastAcknowledgements.submissionId, sub.id)),
      db
        .select({ value: count() })
        .from(staff)
        .where(and(eq(staff.status, 'active'), eq(staff.isExternalTrainer, false))),
    ])
    submission = {
      id: sub.id,
      weekStart: sub.weekStart,
      note: sub.note,
      createdAt: sub.createdAt,
      items: its.map((i) => ({ itemName: i.itemName, quantity: i.quantity })),
      acknowledged: acks.some((a) => a.staffId === staffMember.id),
      ackCount: acks.length,
      totalStaff: Number(totals[0]?.value ?? 0),
    }
  }

  let breakfastItems: { id: string; name: string; unit: string | null; stockQuantity: number }[] =
    []
  if (staffMember.isBreakfastLead) {
    breakfastItems = await db
      .select({
        id: items.id,
        name: items.name,
        unit: items.unit,
        stockQuantity: items.stockQuantity,
      })
      .from(items)
      .where(eq(items.category, 'breakfast'))
      .orderBy(asc(items.name))
  }

  return c.json({
    success: true,
    data: {
      isBreakfastLead: staffMember.isBreakfastLead,
      currentWeekStart: mondayOf(new Date()),
      submission,
      breakfastItems,
    },
  })
})

// POST /api/staff-portal/breakfast — lead submits the weekly list. Decrements
// the breakfast inventory (with a stock-movement ledger entry) and notifies staff.
staffPortalApp.post('/breakfast', async (c) => {
  const staffMember = await getStaffForUser(c)
  if (!staffMember) return c.json({ error: 'Not authenticated' }, 401)
  if (!staffMember.isBreakfastLead)
    return c.json({ error: 'Only the breakfast lead can submit the weekly list' }, 403)
  const db = getDb(process.env.DATABASE_URL!)
  const body = (await c.req.json().catch(() => ({}))) as {
    weekStart?: string
    note?: string
    items?: { itemId: string; quantity: number }[]
  }
  const weekStart =
    typeof body.weekStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.weekStart)
      ? body.weekStart
      : mondayOf(new Date())
  const lines = (Array.isArray(body.items) ? body.items : []).filter(
    (l) => l && typeof l.itemId === 'string' && Number(l.quantity) > 0
  )
  if (lines.length === 0) return c.json({ error: 'Add at least one item with a quantity' }, 400)

  const existing = await db.query.breakfastSubmissions.findFirst({
    where: eq(breakfastSubmissions.weekStart, weekStart),
  })
  if (existing) return c.json({ error: 'Breakfast for this week has already been submitted.' }, 409)

  const rows = await db
    .select()
    .from(items)
    .where(
      and(
        inArray(
          items.id,
          lines.map((l) => l.itemId)
        ),
        eq(items.category, 'breakfast')
      )
    )
  const byId = new Map(rows.map((r) => [r.id, r]))
  for (const l of lines) {
    const it = byId.get(l.itemId)
    if (!it) return c.json({ error: 'One or more items are not breakfast inventory' }, 400)
    if (it.stockQuantity < l.quantity)
      return c.json({ error: `Not enough stock of ${it.name} (have ${it.stockQuantity})` }, 400)
  }

  const submission = await db.transaction(async (tx) => {
    const [sub] = await tx
      .insert(breakfastSubmissions)
      .values({ weekStart, submittedByStaffId: staffMember.id, note: body.note ?? null })
      .returning()
    for (const l of lines) {
      const it = byId.get(l.itemId)!
      await tx
        .update(items)
        .set({ stockQuantity: it.stockQuantity - l.quantity, updatedAt: new Date() })
        .where(eq(items.id, it.id))
      await tx.insert(stockMovements).values({
        itemId: it.id,
        type: 'issue',
        qty: l.quantity,
        sourceType: 'breakfast',
        sourceId: sub.id,
        reason: `Weekly breakfast (${weekStart})`,
        createdById: staffMember.userId,
      } as never)
      await tx
        .insert(breakfastSubmissionItems)
        .values({ submissionId: sub.id, itemId: it.id, itemName: it.name, quantity: l.quantity })
    }
    return sub
  })

  if (await breakfastNotificationsEnabled(db)) {
    const recipients = await db
      .select({ userId: staff.userId })
      .from(staff)
      .where(and(eq(staff.status, 'active'), isNull(staff.deletedAt)))
    const userIds = recipients
      .map((r) => r.userId)
      .filter((id): id is string => !!id && id !== staffMember.userId)
    if (userIds.length) {
      try {
        await sendPushToUsers(userIds, {
          title: 'Breakfast is here 🥐',
          body: 'This week’s breakfast has been submitted — open the app to confirm you received your pack.',
          url: '/breakfast',
        })
      } catch (err) {
        logError(err, { context: '[staff-portal] breakfast push' })
      }
    }
  }

  return c.json({ success: true, data: submission })
})

// POST /api/staff-portal/breakfast/:id/acknowledge — colleague confirms receipt.
staffPortalApp.post('/breakfast/:id/acknowledge', async (c) => {
  const staffMember = await getStaffForUser(c)
  if (!staffMember) return c.json({ error: 'Not authenticated' }, 401)
  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')
  const sub = await db.query.breakfastSubmissions.findFirst({
    where: eq(breakfastSubmissions.id, id),
  })
  if (!sub) return c.json({ error: 'Submission not found' }, 404)
  await db
    .insert(breakfastAcknowledgements)
    .values({ submissionId: id, staffId: staffMember.id })
    .onConflictDoNothing()
  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// Documents — View & Download (with access logging)
// ---------------------------------------------------------------------------

staffPortalApp.get('/documents', async (c) => {
  const staffMember = await getStaffForUser(c)
  if (!staffMember) return c.json({ error: 'Not authenticated' }, 401)

  if (staffMember.isExternalTrainer) {
    return c.json({ success: true, data: [] }) // No documents for trainers
  }

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const data = await db.query.staffDocuments.findMany({
      where: eq(staffDocuments.staffId, staffMember.id),
      orderBy: [desc(staffDocuments.uploadedAt)],
    })
    return c.json({ success: true, data })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to fetch documents' }, 500)
  }
})

/** Log document access (view or download) */
staffPortalApp.post('/documents/:id/access', async (c) => {
  const staffMember = await getStaffForUser(c)
  if (!staffMember) return c.json({ error: 'Not authenticated' }, 401)

  const documentId = c.req.param('id')
  const body = await c.req.json()
  const db = getDb(process.env.DATABASE_URL!)

  try {
    // HR-L8: only log access to a document the caller actually owns. Without this
    // a staff member could forge access-log entries against any document id
    // (incl. a colleague's), polluting the compliance access-log trail.
    const doc = await db.query.staffDocuments.findFirst({
      where: and(eq(staffDocuments.id, documentId), eq(staffDocuments.staffId, staffMember.id)),
      columns: { id: true },
    })
    if (!doc) return c.json({ error: 'Document not found' }, 404)

    await db.insert(documentAccessLogs).values({
      documentId,
      staffId: staffMember.id,
      action: body.action || 'viewed',
    })
    return c.json({ success: true })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to log access' }, 500)
  }
})

// ---------------------------------------------------------------------------
// Performance — View own scores
// ---------------------------------------------------------------------------

staffPortalApp.get('/performance', async (c) => {
  const staffMember = await getStaffForUser(c)
  if (!staffMember) return c.json({ error: 'Not authenticated' }, 401)

  if (staffMember.isExternalTrainer) {
    return c.json({ success: true, data: [] })
  }

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const data = await db.query.performanceScores.findMany({
      where: eq(performanceScores.staffId, staffMember.id),
      orderBy: [desc(performanceScores.evaluatedAt)],
    })
    return c.json({ success: true, data })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to fetch performance scores' }, 500)
  }
})

staffPortalApp.get('/questionnaires', async (c) => {
  const staffMember = await getStaffForUser(c)
  if (!staffMember) return c.json({ error: 'Not authenticated' }, 401)

  if (staffMember.isExternalTrainer) {
    return c.json({ success: true, data: [] })
  }

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const data = await db.query.staffQuestionnaires.findMany({
      where: eq(staffQuestionnaires.active, true),
      with: {
        questions: {
          orderBy: [
            asc(staffQuestionnaireQuestions.orderIndex),
            asc(staffQuestionnaireQuestions.createdAt),
          ],
        },
      },
      orderBy: [asc(staffQuestionnaires.name)],
    })
    return c.json({ success: true, data })
  } catch (error: unknown) {
    logError(error, { context: '[staff-portal] GET /questionnaires error' })
    return c.json({ error: 'Failed to fetch questionnaires' }, 500)
  }
})

staffPortalApp.get('/questionnaires/responses', async (c) => {
  const staffMember = await getStaffForUser(c)
  if (!staffMember) return c.json({ error: 'Not authenticated' }, 401)

  if (staffMember.isExternalTrainer) {
    return c.json({ success: true, data: [] })
  }

  const weekStartDate = c.req.query('weekStartDate')
  const base = weekStartDate ? new Date(weekStartDate) : new Date()
  if (Number.isNaN(base.getTime())) {
    return c.json({ error: 'Invalid weekStartDate' }, 400)
  }

  const day = base.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const weekStart = new Date(base)
  weekStart.setDate(base.getDate() + diff)
  weekStart.setHours(0, 0, 0, 0)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const data = await db.query.staffQuestionnaireResponses.findMany({
      where: and(
        eq(staffQuestionnaireResponses.staffId, staffMember.id),
        eq(staffQuestionnaireResponses.weekStartDate, weekStart)
      ),
      orderBy: [asc(staffQuestionnaireResponses.createdAt)],
    })

    return c.json({ success: true, data })
  } catch (error: unknown) {
    logError(error, { context: '[staff-portal] GET /questionnaires/responses error' })
    return c.json({ error: 'Failed to fetch questionnaire responses' }, 500)
  }
})

staffPortalApp.post('/questionnaires/responses', async (c) => {
  const staffMember = await getStaffForUser(c)
  if (!staffMember) return c.json({ error: 'Not authenticated' }, 401)

  if (staffMember.isExternalTrainer) {
    return c.json({ error: 'External trainers cannot submit questionnaire responses' }, 403)
  }

  const body = await c.req.json()
  const answers = Array.isArray(body?.answers) ? body.answers : []
  if (!answers.length) return c.json({ error: 'answers is required' }, 400)

  const weekBase = body?.weekStartDate ? new Date(body.weekStartDate) : new Date()
  if (Number.isNaN(weekBase.getTime())) {
    return c.json({ error: 'Invalid weekStartDate' }, 400)
  }

  const day = weekBase.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const weekStart = new Date(weekBase)
  weekStart.setDate(weekBase.getDate() + diff)
  weekStart.setHours(0, 0, 0, 0)

  // Each entry: { questionId, score?, answer? }
  // scale questions use score, multichoice use answer
  const cleanedAnswers = answers
    .map((entry: any) => ({
      questionId: String(entry?.questionId || '').trim(),
      score: entry?.score !== undefined ? Number(entry.score) : null,
      answer: entry?.answer !== undefined ? String(entry.answer).trim() : null,
    }))
    .filter((entry: any) => entry.questionId && (Number.isFinite(entry.score) || entry.answer))

  if (!cleanedAnswers.length) {
    return c.json({ error: 'No valid answers provided' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const questionIds: string[] = Array.from(
      new Set(cleanedAnswers.map((entry: any) => entry.questionId as string))
    )
    const validQuestions = await db.query.staffQuestionnaireQuestions.findMany({
      where: inArray(staffQuestionnaireQuestions.id, questionIds),
      columns: { id: true, questionType: true },
    })
    const validQuestionMap = new Map(validQuestions.map((q) => [q.id, q]))

    const safeAnswers = cleanedAnswers
      .filter((entry: any) => validQuestionMap.has(entry.questionId))
      .map((entry: any) => {
        const q = validQuestionMap.get(entry.questionId)!
        if (q.questionType === 'multichoice') {
          return { questionId: entry.questionId, score: 0, answer: entry.answer || '' }
        }
        return {
          questionId: entry.questionId,
          score: Math.max(0, Math.min(5, entry.score ?? 0)),
          answer: null,
        }
      })

    if (!safeAnswers.length) {
      return c.json({ error: 'No valid questionnaire questions found' }, 400)
    }

    await db.delete(staffQuestionnaireResponses).where(
      and(
        eq(staffQuestionnaireResponses.staffId, staffMember.id),
        eq(staffQuestionnaireResponses.weekStartDate, weekStart),
        inArray(
          staffQuestionnaireResponses.questionId,
          safeAnswers.map((answer: any) => answer.questionId)
        )
      )
    )

    const inserted = await db
      .insert(staffQuestionnaireResponses)
      .values(
        safeAnswers.map((answer: any) => ({
          staffId: staffMember.id,
          questionId: answer.questionId,
          weekStartDate: weekStart,
          score: answer.score,
          answer: answer.answer,
        }))
      )
      .returning()

    return c.json({ success: true, data: inserted })
  } catch (error: unknown) {
    logError(error, { context: '[staff-portal] POST /questionnaires/responses error' })
    return c.json({ error: 'Failed to save questionnaire responses' }, 500)
  }
})

// ---------------------------------------------------------------------------
// Training — View assigned training & update progress
// ---------------------------------------------------------------------------

// PR-29 — strip the correct-answer key from every quiz question before
// shipping the material to the staff PWA. Storing it server-side is fine;
// returning it lets the client recover any answer with a DevTools breakpoint.
function stripQuizAnswers<T extends { quizQuestions?: unknown }>(material: T): T {
  if (!material || !Array.isArray(material.quizQuestions)) return material
  return {
    ...material,
    quizQuestions: (material.quizQuestions as Array<Record<string, unknown>>).map((q) => {
      const { correctAnswerIndex: _strip, ...safe } = q
      void _strip
      return safe
    }),
  } as T
}

staffPortalApp.get('/training', async (c) => {
  const staffMember = await getStaffForUser(c)
  if (!staffMember) return c.json({ error: 'Not authenticated' }, 401)

  const db = getDb(process.env.DATABASE_URL!)

  try {
    const progress = await db.query.staffTrainingProgress.findMany({
      where: eq(staffTrainingProgress.staffId, staffMember.id),
      with: { training: true },
      orderBy: [desc(staffTrainingProgress.createdAt)],
    })

    const existingTrainingIds = new Set(progress.map((item) => item.trainingId))
    const allMaterials = await db.query.trainingMaterials.findMany({
      orderBy: [desc(trainingMaterials.createdAt)],
    })

    const missingProgressRows = allMaterials
      .filter((material) => {
        if (existingTrainingIds.has(material.id)) return false
        // PR-40 — don't backfill drafts. Wasted rows + the PWA was
        // already filtering them out on the way in.
        if (!material.published) return false

        const assignedTo = Array.isArray(material.assignedTo) ? material.assignedTo : []

        // PR-40 — published + no explicit assignment = broadcast. Modules
        // created before PR-34's assignment UI shipped had empty arrays;
        // without this clause they were invisible to everyone even after
        // publishing. HR narrows the audience explicitly via assignedTo;
        // an empty list defaults to broadcast.
        const unassigned = assignedTo.length === 0
        const forAll = unassigned || assignedTo.includes('all')
        const forStaff = assignedTo.includes(staffMember.id)

        return forAll || forStaff
      })
      .map((material) => ({
        staffId: staffMember.id,
        trainingId: material.id,
      }))

    if (missingProgressRows.length > 0) {
      await db.insert(staffTrainingProgress).values(missingProgressRows)
    }

    const finalProgress = await db.query.staffTrainingProgress.findMany({
      where: eq(staffTrainingProgress.staffId, staffMember.id),
      with: { training: true },
      orderBy: [desc(staffTrainingProgress.createdAt)],
    })

    // PR-29 — strip correctAnswerIndex on the way out so the PWA can't
    // grade locally + spoof the result.
    const sanitized = finalProgress.map((row) =>
      row.training ? { ...row, training: stripQuizAnswers(row.training) } : row
    )

    return c.json({ success: true, data: sanitized })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to fetch training' }, 500)
  }
})

/** Update training progress.
 *
 * PR-29 — `score` is no longer writable from this endpoint. Scores are
 * authoritative output of /submit-quiz, computed against the server-stored
 * correctAnswerIndex; allowing the client to PATCH them in was a one-line
 * cheat. `status='completed'` is also rejected because completion implies
 * a graded attempt — the staff must go through /submit-quiz. This route
 * is now strictly for "I've read N% of the content" reading-progress
 * tracking.
 */
staffPortalApp.patch('/training/:id/progress', async (c) => {
  const staffMember = await getStaffForUser(c)
  if (!staffMember) return c.json({ error: 'Not authenticated' }, 401)

  const progressId = c.req.param('id')
  // `?? {}` matters: a literal JSON `null` body parses fine, so `.catch()`
  // never fires and every `body.x` read below would throw.
  const body = (await c.req.json().catch(() => null)) ?? {}
  const db = getDb(process.env.DATABASE_URL!)

  try {
    const updates: Record<string, unknown> = { updatedAt: new Date() }
    if (typeof body.progressPercent === 'number') {
      const pct = body.progressPercent
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        return c.json({ error: 'progressPercent must be 0..100' }, 400)
      }
      updates.progressPercent = pct
    }
    if (body.status === 'in_progress') {
      updates.status = 'in_progress'
      if (!body.startedAt) updates.startedAt = new Date()
    } else if (body.status !== undefined && body.status !== 'not_started') {
      // 'completed' and arbitrary status strings are now blocked here. The
      // completion path is /submit-quiz, which writes status server-side.
      return c.json(
        {
          error:
            'Completion happens via /submit-quiz. This endpoint accepts in_progress + progressPercent only.',
          code: 'STATUS_TRANSITION_BLOCKED',
        },
        400
      )
    }

    const [updated] = await db
      .update(staffTrainingProgress)
      .set(updates)
      .where(
        and(
          eq(staffTrainingProgress.id, progressId),
          eq(staffTrainingProgress.staffId, staffMember.id)
        )
      )
      .returning()

    if (!updated) return c.json({ error: 'Progress record not found' }, 404)
    return c.json({ success: true, data: updated })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to update progress' }, 500)
  }
})

// ---------------------------------------------------------------------------
// Profile — View own profile
// ---------------------------------------------------------------------------

staffPortalApp.get('/profile', async (c) => {
  const staffMember = await getStaffForUser(c)
  if (!staffMember) return c.json({ error: 'Not authenticated' }, 401)

  return c.json({
    success: true,
    data: {
      id: staffMember.id,
      staffId: staffMember.staffId,
      fullName: staffMember.fullName,
      username: staffMember.username,
      email: staffMember.email,
      phone: staffMember.phone,
      role: staffMember.role,
      position: staffMember.position,
      employmentType: staffMember.employmentType,
      dateOfJoining: staffMember.dateOfJoining,
      status: staffMember.status,
      isExternalTrainer: staffMember.isExternalTrainer,
      profileImage: staffMember.profileImage,
      emergencyContactName: staffMember.emergencyContactName,
      emergencyContactPhone: staffMember.emergencyContactPhone,
      cvUrl: staffMember.cvUrl,
      // PWA reads this on sign-in to gate the initial-password-change screen.
      // Cleared by POST /api/staff-auth/clear-first-login after Better Auth's
      // change-password completes successfully.
      isFirstLogin: staffMember.isFirstLogin,
    },
  })
})

// GET /data-sheet — the signed-in staff member downloads their own Employee
// Data Sheet as a PDF.
staffPortalApp.get('/data-sheet', async (c) => {
  const staffMember = await getStaffForUser(c)
  if (!staffMember) return c.json({ error: 'Not authenticated' }, 401)

  const branding = await getBranding().catch(() => null)
  const html = await buildEmployeeDataSheetHtml(staffMember, {
    clinicName: branding?.name ?? 'Denel Dental Clinic',
    clinicPhone: branding?.phones?.[0] ?? null,
    clinicAddress: branding?.address ?? null,
    logoUrl: branding?.logoHorizontalUrl ?? branding?.logoUrl ?? null,
    generatedByName: staffMember.fullName,
  })
  const pdf = await renderHtmlToPdf(html)
  const safeId = String(staffMember.staffId ?? 'staff').replace(/[^a-zA-Z0-9_-]/g, '')
  return c.body(new Uint8Array(pdf), 200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="employee-data-sheet-${safeId}.pdf"`,
  })
})

// ---------------------------------------------------------------------------
// Attendance — view own attendance, derived from device punches (attendance_events)
// ---------------------------------------------------------------------------

// HH:MM → HH:MM duration in hours (1dp), wrapping past midnight.
function hoursBetweenHHMM(inHHMM: string, outHHMM: string): number {
  const [ih, im] = inHHMM.split(':').map(Number)
  const [oh, om] = outHHMM.split(':').map(Number)
  let mins = oh * 60 + om - (ih * 60 + im)
  if (mins < 0) mins += 24 * 60
  return Math.round((mins / 60) * 10) / 10
}

staffPortalApp.get('/attendance', async (c) => {
  const staffMember = await getStaffForUser(c)
  if (!staffMember) return c.json({ error: 'Not authenticated' }, 401)

  const db = getDb(process.env.DATABASE_URL!)

  // HR-M4: derive the self-service view from attendance_events using the SAME
  // clock-pair aggregation the admin view uses (fetchDailySummariesForStaffRange),
  // instead of reading staff_attendance — a table no ingestion path ever writes,
  // which left this page permanently empty. Staff and admin now agree.
  const weekParam = c.req.query('week')
  const anchor = weekParam ? new Date(weekParam) : new Date()
  const weekStartMonday = startOfWeekMonUtc(anchor)
  const todayMonday = startOfWeekMonUtc(new Date())
  const msPerWeek = 7 * 24 * 60 * 60 * 1000
  // How many weeks back the aggregation must reach to cover the requested week.
  const weeksBack = Math.max(
    1,
    Math.round((todayMonday.getTime() - weekStartMonday.getTime()) / msPerWeek) + 1
  )
  const { daysByYmd } = await fetchDailySummariesForStaffRange(db, staffMember.id, weeksBack)

  const days = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStartMonday)
    d.setUTCDate(weekStartMonday.getUTCDate() + i)
    const ymd = formatYMD(d)
    const rec = daysByYmd.get(ymd) ?? emptyDayRecord(ymd, d.getUTCDay())
    days.push({
      date: ymd,
      clockIn: rec.clockIn,
      clockOut: rec.clockOut,
      hoursWorked: rec.clockIn && rec.clockOut ? hoursBetweenHHMM(rec.clockIn, rec.clockOut) : null,
      status: rec.status,
    })
  }

  const weekEndSunday = new Date(weekStartMonday)
  weekEndSunday.setUTCDate(weekStartMonday.getUTCDate() + 6)
  const totalHours = days.reduce((sum, d) => sum + (d.hoursWorked ?? 0), 0)
  const daysPresent = days.filter((d) => d.status === 'present' || d.status === 'late').length
  const daysLate = days.filter((d) => d.status === 'late').length
  const daysAbsent = days.filter((d) => d.status === 'absent').length

  return c.json({
    success: true,
    data: {
      week: {
        startDate: formatYMD(weekStartMonday),
        endDate: formatYMD(weekEndSunday),
        label: weekLabel(weekStartMonday, weekEndSunday),
      },
      days,
      summary: { totalHours: Math.round(totalHours * 10) / 10, daysPresent, daysLate, daysAbsent },
    },
  })
})

staffPortalApp.get('/attendance/history', async (c) => {
  const staffMember = await getStaffForUser(c)
  if (!staffMember) return c.json({ error: 'Not authenticated' }, 401)

  const db = getDb(process.env.DATABASE_URL!)
  const page = Math.max(1, Number(c.req.query('page') ?? 1))
  const pageSize = 31

  const records = await db
    .select()
    .from(staffAttendance)
    .where(eq(staffAttendance.staffId, staffMember.id))
    .orderBy(desc(staffAttendance.date))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  return c.json({ success: true, data: records, page })
})

staffPortalApp.get('/attendance/submissions', async (c) => {
  const staffMember = await getStaffForUser(c)
  if (!staffMember) return c.json({ error: 'Not authenticated' }, 401)

  const db = getDb(process.env.DATABASE_URL!)
  const submissions = await db
    .select()
    .from(staffAttendanceSubmissions)
    .where(eq(staffAttendanceSubmissions.staffId, staffMember.id))
    .orderBy(desc(staffAttendanceSubmissions.date), desc(staffAttendanceSubmissions.createdAt))

  return c.json({ success: true, data: submissions })
})

staffPortalApp.post(
  '/attendance/submissions',
  zValidator(
    'json',
    z.object({
      date: z.string(),
      punchType: z.enum(['clock_in', 'clock_out']),
      time: z.string(),
      reason: z.string().optional(),
    })
  ),
  async (c) => {
    const staffMember = await getStaffForUser(c)
    if (!staffMember) return c.json({ error: 'Not authenticated' }, 401)

    const data = c.req.valid('json')
    const db = getDb(process.env.DATABASE_URL!)

    const [submission] = await db
      .insert(staffAttendanceSubmissions)
      .values({
        staffId: staffMember.id,
        date: data.date,
        punchType: data.punchType,
        time: data.time,
        reason: data.reason,
        status: 'pending',
      })
      .returning()

    return c.json({ success: true, data: submission })
  }
)

// ---------------------------------------------------------------------------
// Payslips — view own published payslips
//
// HR-L12: self-service endpoints intentionally gate on AUTH + OWNERSHIP only, not
// a module permission. getStaffForUser() scopes every query to the caller's own
// staff row (no client-supplied staffId), and payslips are filtered to
// status='published'. A `payroll:read` check would be WRONG here — regular staff
// don't hold payroll:read (it's an admin/HR permission), so requiring it would
// deny every employee access to their OWN payslip. Ownership is the guard.
// ---------------------------------------------------------------------------

staffPortalApp.get('/payslips', async (c) => {
  const staffMember = await getStaffForUser(c)
  if (!staffMember) return c.json({ error: 'Not authenticated' }, 401)

  const db = getDb(process.env.DATABASE_URL!)

  const data = await db
    .select({
      id: payslips.id,
      staffId: payslips.staffId,
      payPeriod: payslips.payPeriod,
      grossPay: payslips.grossPay,
      netPay: payslips.netPay,
      deductions: payslips.deductions,
      fileUrl: payslips.fileUrl,
      status: payslips.status,
      publishedAt: payslips.publishedAt,
      uploadedById: payslips.uploadedById,
      payrollRunId: payslips.payrollRunId,
      createdAt: payslips.createdAt,
      updatedAt: payslips.updatedAt,
      disbursedAt: payrollRuns.disbursedAt,
    })
    .from(payslips)
    .leftJoin(payrollRuns, eq(payrollRuns.id, payslips.payrollRunId))
    .where(
      and(
        eq(payslips.staffId, staffMember.id),
        or(eq(payslips.status, 'published'), eq(payslips.status, 'suspended'))
      )
    )
    .orderBy(desc(payslips.payPeriod))

  return c.json({ success: true, data })
})

staffPortalApp.get('/payslips/:id', async (c) => {
  const staffMember = await getStaffForUser(c)
  if (!staffMember) return c.json({ error: 'Not authenticated' }, 401)

  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')

  const [slip] = await db
    .select({
      id: payslips.id,
      staffId: payslips.staffId,
      payPeriod: payslips.payPeriod,
      grossPay: payslips.grossPay,
      netPay: payslips.netPay,
      deductions: payslips.deductions,
      fileUrl: payslips.fileUrl,
      status: payslips.status,
      publishedAt: payslips.publishedAt,
      uploadedById: payslips.uploadedById,
      payrollRunId: payslips.payrollRunId,
      createdAt: payslips.createdAt,
      updatedAt: payslips.updatedAt,
      disbursedAt: payrollRuns.disbursedAt,
    })
    .from(payslips)
    .leftJoin(payrollRuns, eq(payrollRuns.id, payslips.payrollRunId))
    .where(
      and(
        eq(payslips.id, id),
        eq(payslips.staffId, staffMember.id),
        or(eq(payslips.status, 'published'), eq(payslips.status, 'suspended'))
      )
    )
    .limit(1)

  if (!slip) return c.json({ error: 'Payslip not found' }, 404)

  const periodDate = new Date(slip.payPeriod as string)
  const components = await db
    .select({
      name: salaryComponents.name,
      type: salaryComponents.type,
      amount: salaryComponents.amount,
    })
    .from(salaryComponents)
    .where(
      and(
        eq(salaryComponents.staffId, staffMember.id),
        lte(salaryComponents.effectiveFrom, periodDate),
        or(isNull(salaryComponents.effectiveTo), gte(salaryComponents.effectiveTo, periodDate))
      )
    )
    .orderBy(asc(salaryComponents.type), asc(salaryComponents.name))

  return c.json({
    success: true,
    data: {
      ...slip,
      components: components.map((comp) => ({
        name: comp.name,
        type: comp.type,
        amount: Number(comp.amount),
      })),
    },
  })
})

// ---------------------------------------------------------------------------
// Training — quiz submission
// ---------------------------------------------------------------------------

staffPortalApp.post('/training/:id/submit-quiz', async (c) => {
  const staffMember = await getStaffForUser(c)
  if (!staffMember) return c.json({ error: 'Not authenticated' }, 401)

  const trainingId = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const rawAnswers = Array.isArray(body?.answers) ? body.answers : []

  const db = getDb(process.env.DATABASE_URL!)

  const material = await db.query.trainingMaterials.findFirst({
    where: eq(trainingMaterials.id, trainingId),
  })
  if (!material) return c.json({ error: 'Training material not found' }, 404)

  const questions = material.quizQuestions ?? []
  if (questions.length === 0) return c.json({ error: 'No quiz questions found' }, 400)

  // PR-29 — DoS guard: cap answer-array length. Without this, a client can
  // submit thousands of entries and pin a worker thread on the grading loop.
  if (rawAnswers.length > questions.length * 2) {
    return c.json({ error: 'Too many answers in payload' }, 400)
  }

  // PR-29 — validate every answer's questionIndex + selectedOption is in
  // range. The previous loop silently skipped junk indices, which let a
  // crafted payload score 100% by submitting only questions that don't
  // exist (gradable.length stays positive, correct stays 0... wait, that
  // would score 0%, not 100%). The real attack vector: legit answers
  // mixed with a `selectedOption: -1` for the questions the staff doesn't
  // know — the predicate `q.correctAnswerIndex === -1` is false so it
  // doesn't increment, no error, but the loop also doesn't error. Either
  // way: validate upfront so misuse returns a clean 400.
  const answers: Array<{ questionIndex: number; selectedOption: number }> = []
  for (const ans of rawAnswers) {
    const qi = Number(ans?.questionIndex)
    const so = Number(ans?.selectedOption)
    if (!Number.isInteger(qi) || qi < 0 || qi >= questions.length) {
      return c.json({ error: `questionIndex ${ans?.questionIndex} out of range` }, 400)
    }
    if (!Number.isInteger(so) || so < 0) {
      return c.json({ error: `selectedOption ${ans?.selectedOption} out of range` }, 400)
    }
    const q = questions[qi] as { questionType?: string; options?: unknown[] }
    if (q?.questionType === 'multichoice') {
      const optCount = Array.isArray(q.options) ? q.options.length : 0
      if (so >= optCount) {
        return c.json({ error: `selectedOption ${so} out of range for question ${qi}` }, 400)
      }
    }
    answers.push({ questionIndex: qi, selectedOption: so })
  }

  // PR-29 — deadline + timer enforcement. UI shows a countdown but the
  // server is the authority. `startedAt` lives on the progress row; if the
  // staff's window has elapsed since they began, the submit is refused.
  const progressRow = await db.query.staffTrainingProgress.findFirst({
    where: and(
      eq(staffTrainingProgress.staffId, staffMember.id),
      eq(staffTrainingProgress.trainingId, trainingId)
    ),
  })

  const [existingAttemptRow] = await db
    .select({ max: sql<number>`coalesce(max(${trainingAttempts.attemptNumber}), 0)::int` })
    .from(trainingAttempts)
    .where(
      and(eq(trainingAttempts.staffId, staffMember.id), eq(trainingAttempts.trainingId, trainingId))
    )
  const existingAttemptCount = existingAttemptRow?.max ?? 0

  if (!material.allowReassessment && existingAttemptCount > 0) {
    return c.json({ error: 'Reassessment is not allowed for this module.' }, 400)
  }

  let forcedFailError: string | null = null
  const now = new Date()
  if (material.deadline && new Date(material.deadline) < now) {
    forcedFailError = 'Training deadline has passed'
  } else if (material.quizTimer && progressRow?.startedAt) {
    const elapsedMs = now.getTime() - new Date(progressRow.startedAt).getTime()
    const limitMs = material.quizTimer * 60 * 1000 + 30_000
    if (elapsedMs > limitMs) {
      forcedFailError = 'Quiz time limit exceeded'
    }
  }

  // Auto-grade only multichoice. Scale questions need a configured scale
  // range / tolerance the creator UI does not currently capture, so a scale
  // answer is recorded but not scored — the trainer review layer takes over.
  // If a quiz is 100% scale, we mark the attempt as "awaiting review" instead
  // of silently scoring 0%.
  const gradable = questions.filter((q) => q.questionType === 'multichoice')
  const awaitingReview = gradable.length === 0

  let correct = 0
  for (const ans of answers) {
    const q = questions[ans.questionIndex]
    if (q && q.questionType === 'multichoice' && q.correctAnswerIndex === ans.selectedOption)
      correct++
  }

  let score =
    awaitingReview || gradable.length === 0 ? null : Math.round((correct / gradable.length) * 100)
  let passed = awaitingReview
    ? false
    : material.passingScore != null
      ? (score as number) >= material.passingScore
      : (score as number) >= 70

  if (forcedFailError) {
    score = 0
    passed = false
  }

  // PR-29 — wrap attempt insert + progress update in a single transaction
  // so a mid-flight failure can't orphan the attempt or stale-sync the
  // progress row. The attempt-number compute also moves inside the tx so
  // two concurrent submits race-cleanly on the (staff, training) index.
  await db.transaction(async (tx) => {
    const [maxAttemptRow] = await tx
      .select({ max: sql<number>`coalesce(max(${trainingAttempts.attemptNumber}), 0)::int` })
      .from(trainingAttempts)
      .where(
        and(
          eq(trainingAttempts.staffId, staffMember.id),
          eq(trainingAttempts.trainingId, trainingId)
        )
      )
    const attemptNumber = (maxAttemptRow?.max ?? 0) + 1
    await tx.insert(trainingAttempts).values({
      staffId: staffMember.id,
      trainingId,
      attemptNumber,
      score,
      awaitingReview,
      passed,
      answers,
      submittedAt: now,
    })

    if (progressRow) {
      if (awaitingReview) {
        await tx
          .update(staffTrainingProgress)
          .set({
            status: 'in_progress',
            progressPercent: 100,
            score: null,
            completedAt: now,
            updatedAt: now,
          })
          .where(eq(staffTrainingProgress.id, progressRow.id))
      } else if (passed) {
        await tx
          .update(staffTrainingProgress)
          .set({
            status: 'completed',
            progressPercent: 100,
            score,
            completedAt: now,
            updatedAt: now,
          })
          .where(eq(staffTrainingProgress.id, progressRow.id))
      } else {
        // Keep the BEST score on the progress row so a failing retake doesn't
        // erase a prior near-pass. Full history lives on training_attempts.
        const bestScore =
          progressRow.score == null
            ? score
            : score == null
              ? progressRow.score
              : Math.max(progressRow.score, score)
        await tx
          .update(staffTrainingProgress)
          .set({ score: bestScore, updatedAt: now, startedAt: null })
          .where(eq(staffTrainingProgress.id, progressRow.id))
      }
    }
  })

  return c.json({
    success: true,
    data: {
      passed,
      score,
      awaitingReview,
      correctCount: correct,
      gradableCount: gradable.length,
      totalCount: questions.length,
      passingScore: material.passingScore ?? 70,
    },
  })
})

// ---------------------------------------------------------------------------
// Profile Change Requests — staff submit change requests
// ---------------------------------------------------------------------------

staffPortalApp.get('/profile/change-requests', async (c) => {
  const staffMember = await getStaffForUser(c)
  if (!staffMember) return c.json({ error: 'Not authenticated' }, 401)

  const db = getDb(process.env.DATABASE_URL!)
  const data = await db
    .select()
    .from(staffProfileChangeRequests)
    .where(eq(staffProfileChangeRequests.staffId, staffMember.id))
    .orderBy(desc(staffProfileChangeRequests.submittedAt))

  return c.json({ success: true, data })
})

staffPortalApp.post('/profile/change-request', async (c) => {
  const staffMember = await getStaffForUser(c)
  if (!staffMember) return c.json({ error: 'Not authenticated' }, 401)

  const body = await c.req.json().catch(() => ({}))

  // Validated against the canonical ESS contract in @denel/types.
  // `requestedData` is raw JSONB — before this it accepted any object of any
  // shape or size, straight from an unauthenticated-adjacent client surface.
  const parsed = profileChangeRequestSchema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return c.json({ error: first?.message ?? 'Invalid change request' }, 400)
  }
  const { changeType, requestedData } = parsed.data

  // Fail at SUBMIT time if this field could never be auto-applied, rather than
  // letting the staffer wait for a review that would silently write nothing.
  // `other` is the free-text escape hatch and legitimately has no field.
  if (requestedData.field && !canSelfServiceApply(changeType, requestedData.field)) {
    return c.json(
      {
        error: `“${requestedData.field}” can't be changed through a self-service request. Use “Something else” to describe what you need, and HR will handle it.`,
      },
      400
    )
  }

  const db = getDb(process.env.DATABASE_URL!)

  const [inserted] = await db
    .insert(staffProfileChangeRequests)
    .values({
      staffId: staffMember.id,
      changeType,
      requestedData,
      status: 'pending',
    })
    .returning({ id: staffProfileChangeRequests.id })

  return c.json({ success: true, id: inserted.id })
})

// ---------------------------------------------------------------------------
// Forgot Password — SMS OTP Flow (unauthenticated)
// ---------------------------------------------------------------------------

/** Step 1: Request OTP — provide Phone Number, receive OTP via SMS */
staffPortalApp.post('/forgot-password/request-otp', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const phoneInput = body.phone?.trim()

  if (!phoneInput) {
    return c.json({ error: 'Phone number is required' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)

  const staffMember = await db.query.staff.findFirst({
    where: eq(staff.phone, phoneInput),
  })

  // Always return success to avoid leaking whether the phone number exists
  if (!staffMember?.phone) {
    return c.json({ success: true, message: 'If the phone number is valid, an OTP has been sent.' })
  }

  const result = await requestStaffOtp(db, staffMember.id, 'password_reset', staffMember.phone)
  if (!result.ok) {
    // Rate limited. Same body as every other branch — the caller must not be
    // able to tell a throttled real number from an unknown one. (The timing
    // half of this is handled in requestStaffOtp, which no longer awaits the
    // outbound SMS; the comment here used to claim timing was covered when it
    // was not.)
    return c.json({ success: true, message: 'If the phone number is valid, an OTP has been sent.' })
  }

  return c.json({ success: true, message: 'If the phone number is valid, an OTP has been sent.' })
})

/**
 * Short fingerprint of the account's current credential hash, embedded in the
 * reset token so the token dies the moment it is spent.
 *
 * The token is a stateless HMAC with a 15-minute expiry. Without this it could
 * be replayed for the whole window, resetting the password repeatedly. Binding
 * it to the password it was issued against makes it single-use with no extra
 * table: once the reset lands, the hash changes and the fingerprint no longer
 * matches.
 */
async function credentialFingerprint(hash: string | null): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(hash ?? ''))
  return Array.from(new Uint8Array(buf))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Step 2: Verify OTP — returns an opaque otpToken for use in reset step */
staffPortalApp.post('/forgot-password/verify-otp', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const { phone: phoneInput, code } = body

  if (!phoneInput || !code) {
    return c.json({ error: 'Phone number and OTP code are required' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)

  const staffMember = await db.query.staff.findFirst({
    where: eq(staff.phone, phoneInput),
  })

  // M1: one message for every failure below, so this step cannot be used to
  // tell a real phone number from an invented one. Step 1 of this flow is
  // already enumeration-resistant; this step used to undo it by answering
  // "Invalid phone number or OTP" for an unknown number but
  // "Code not found or expired" / "Incorrect code. 4 attempts remaining." for a
  // real one — submit any code and the wording told you which you had.
  if (!staffMember) {
    return c.json({ error: OTP_GENERIC_ERROR }, 400)
  }

  const result = await verifyStaffOtp(db, staffMember.id, 'password_reset', code)
  if (!result.ok) {
    // `result.reason` distinguishes the cases for the server log only — it must
    // never reach the response body.
    return c.json({ error: OTP_GENERIC_ERROR }, 400)
  }

  // Issue a short-lived HMAC token — client passes this in the reset step
  const secret = process.env.BETTER_AUTH_SECRET!
  const payload = JSON.stringify({
    staffId: staffMember.id,
    purpose: 'password_reset',
    exp: Date.now() + 15 * 60 * 1000,
    // Binds the token to the password it was issued against — see
    // credentialFingerprint(). Makes it single-use.
    pv: await credentialFingerprint(
      staffMember.userId ? await getCredentialHash(db, staffMember.userId) : null
    ),
  })
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  const sigHex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  const resetToken = `${btoa(payload)}.${sigHex}`

  return c.json({ success: true, resetToken })
})

/** Step 3: Reset password using the token from Step 2 */
staffPortalApp.post('/forgot-password/reset', async (c) => {
  const body = await c.req.json()
  const { resetToken, newPassword } = body

  if (!resetToken || !newPassword) {
    return c.json({ error: 'resetToken and newPassword are required' }, 400)
  }

  // L9 — one shared policy. This route used to require 8 characters while
  // staff-core required 10 and routes/users.ts deferred to Better Auth's
  // default, so the strictest rule was decorative: the same account could be
  // given a password another route would have refused.
  const policy = checkPasswordPolicy(newPassword)
  if (!policy.ok) {
    return c.json({ error: policy.error }, 400)
  }

  // Verify the HMAC token
  let staffUuid: string
  let tokenFingerprint: string | null = null
  try {
    const secret = process.env.BETTER_AUTH_SECRET!
    const dotIdx = resetToken.lastIndexOf('.')
    if (dotIdx === -1) throw new Error('bad token')
    const payloadB64 = resetToken.slice(0, dotIdx)
    const sigHex = resetToken.slice(dotIdx + 1)
    const payload = atob(payloadB64)
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )
    const sigBytes = Uint8Array.from(sigHex.match(/.{2}/g)?.map((h: string) => parseInt(h, 16)))
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      new TextEncoder().encode(payload)
    )
    if (!valid) throw new Error('bad sig')
    const data = JSON.parse(payload)
    if (data.purpose !== 'password_reset' || data.exp < Date.now()) throw new Error('expired')
    staffUuid = data.staffId
    tokenFingerprint = typeof data.pv === 'string' ? data.pv : null
  } catch {
    return c.json({ error: 'Invalid or expired reset session. Please request a new code.' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)

  const staffMember = await db.query.staff.findFirst({
    where: eq(staff.id, staffUuid),
  })

  if (!staffMember?.userId) {
    return c.json({ error: 'Invalid request' }, 400)
  }

  // Single-use: the token carries a fingerprint of the password it was issued
  // against. If it no longer matches, this token has already been spent (or the
  // password changed by another route) and must not work a second time.
  const currentFingerprint = await credentialFingerprint(
    await getCredentialHash(db, staffMember.userId)
  )
  if (tokenFingerprint !== currentFingerprint) {
    return c.json({ error: 'This reset link has already been used. Request a new code.' }, 400)
  }

  // L9 (the reuse half): refuse to set the password back to the current one.
  // Otherwise a reset can complete "successfully" and change nothing — which
  // defeats the point when the reason for the reset is a suspected compromise.
  if (await isSameAsCurrent(newPassword, await getCredentialHash(db, staffMember.userId))) {
    return c.json({ error: 'Choose a password you have not used before.' }, 400)
  }

  // Writes the password AND revokes every session, as one operation. Writing
  // `account.password` directly (as this did) bypasses Better Auth entirely:
  // no hook fires, so nothing revoked the sessions and a reset left both the
  // attacker's and the victim's existing sessions alive.
  await setUserPassword(db, staffMember.userId, newPassword)

  // The person chose this password themselves (through the SMS code), which ends any
  // "an administrator set it" state (F20 / D8) — otherwise the portal or HR app would ask
  // them to change a password they have just chosen.
  await clearPasswordChange(db, staffMember.userId)

  // Password change also resets all device trust.
  await revokeAllStaffDevices(db, staffMember.id)

  return c.json({ success: true, message: 'Password has been reset successfully' })
})

export { staffPortalApp }

staffPortalApp.get('/payslips/:id/pdf', async (c) => {
  const staffMember = await getStaffForUser(c)
  if (!staffMember) return c.json({ error: 'Not authenticated' }, 401)
  const id = c.req.param('id')
  return handleGetSinglePayslipPdf(c, id, staffMember.id)
})
