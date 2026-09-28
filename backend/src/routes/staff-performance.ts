import { and, asc, desc, eq, gte, inArray, lt } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import {
  attendanceEvents,
  attendanceExceptions,
  performanceScores,
  staff,
  staffQuestionnaireQuestions,
  staffQuestionnaires,
  staffRequests,
  staffTrainingProgress,
  trainingAttempts,
  trainingMaterials,
  user,
} from '../db/schema'
import {
  type ApprovedLeave,
  dailySummaries,
  type AttendanceEvent as LibAttendanceEvent,
  type AttendanceException as LibAttendanceException,
  monthlySummary,
  monthRangeUtc,
} from '../lib/attendance'
import { effectiveEventTsSql, toLibEvent } from '../lib/attendance-events'
import { fetchOverridesByStaff } from '../lib/attendance-overrides'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'
import { defaultMonthYYYYMM, formatYMD, groupBy, isValidMonth } from './staff-attendance'

const app = new Hono<HonoEnv>()

// ---------------------------------------------------------------------------
// Performance Scores (Admin create/manage)
// ---------------------------------------------------------------------------

/** Add performance score for a staff member */
app.post('/performance', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.CREATE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const body = await c.req.json()

    // Validation
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const ALLOWED_CATEGORIES = [
      'technical_skills',
      'soft_skills',
      'attendance',
      'patient_satisfaction',
      'teamwork',
    ]
    const fieldErrors: Record<string, string> = {}
    if (!body.staffId || typeof body.staffId !== 'string' || !UUID_RE.test(body.staffId)) {
      fieldErrors.staffId = 'staffId must be a valid UUID'
    }
    if (!body.evaluationPeriod || typeof body.evaluationPeriod !== 'string') {
      fieldErrors.evaluationPeriod = 'evaluationPeriod is required'
    }
    if (!body.category || !ALLOWED_CATEGORIES.includes(body.category)) {
      fieldErrors.category = `category must be one of: ${ALLOWED_CATEGORIES.join(', ')}`
    }
    const scoreNum = Number(body.score)
    if (!Number.isFinite(scoreNum) || scoreNum < 1 || scoreNum > 5) {
      fieldErrors.score = 'score must be a number between 1 and 5'
    }
    if (Object.keys(fieldErrors).length > 0) {
      return c.json({ error: 'Validation failed', fields: fieldErrors }, 400)
    }

    const db = getDb(process.env.DATABASE_URL!)

    const [score] = await db
      .insert(performanceScores)
      .values({
        staffId: body.staffId,
        evaluationPeriod: body.evaluationPeriod,
        category: body.category,
        score: scoreNum,
        notes: body.notes,
        feedback: body.feedback,
        evaluatedById: authUser.id,
      })
      .returning()

    return c.json({ success: true, data: score })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to add performance score' }, 500)
  }
})

/** List all performance scores with staff info */
app.get('/performance/all', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.READ as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const data = await db.query.performanceScores.findMany({
      with: { staff: true },
      orderBy: [desc(performanceScores.evaluatedAt)],
    })
    return c.json({ success: true, data })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to fetch performance scores' }, 500)
  }
})

/** Save weekly scores in bulk from the management hub upload */
app.post('/performance/weekly-batch', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.CREATE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const body = await c.req.json()
    const entries = Array.isArray(body?.entries) ? body.entries : []
    if (!entries.length) {
      return c.json({ error: 'entries is required' }, 400)
    }

    const db = getDb(process.env.DATABASE_URL!)
    const staffRows = await db.query.staff.findMany({
      columns: { id: true, staffId: true, fullName: true },
    })

    const byId = new Map(staffRows.map((s) => [s.id, s]))
    const byStaffCode = new Map(staffRows.map((s) => [String(s.staffId || '').toLowerCase(), s]))
    // HR-M8: fullName is non-unique (no DB constraint), and this batch
    // DELETE-then-INSERTs scores, so a name-only match could destructively
    // overwrite the WRONG staffer's record. Index only names that are unique;
    // a duplicated name is left out so such rows fall through to "unresolved"
    // rather than silently picking last-writer-wins.
    const nameCounts = new Map<string, number>()
    for (const s of staffRows) {
      const k = String(s.fullName || '').toLowerCase()
      nameCounts.set(k, (nameCounts.get(k) ?? 0) + 1)
    }
    const byName = new Map(
      staffRows
        .filter((s) => nameCounts.get(String(s.fullName || '').toLowerCase()) === 1)
        .map((s) => [String(s.fullName || '').toLowerCase(), s])
    )

    const unresolved: string[] = []
    let written = 0

    for (const entry of entries) {
      const staffMatch =
        (entry?.staffId ? byId.get(String(entry.staffId)) : undefined) ||
        (entry?.staffCode ? byStaffCode.get(String(entry.staffCode).toLowerCase()) : undefined) ||
        (entry?.staffName ? byName.get(String(entry.staffName).toLowerCase()) : undefined)

      if (!staffMatch) {
        unresolved.push(String(entry?.staffCode || entry?.staffId || entry?.staffName || 'unknown'))
        continue
      }

      const weekStartDate = String(entry.weekStartDate || '').trim()
      if (!weekStartDate) {
        unresolved.push(String(entry?.staffCode || entry?.staffId || entry?.staffName || 'unknown'))
        continue
      }

      const evaluationPeriod = String(entry.evaluationPeriod || `week-${weekStartDate}`)
      const attendanceScore = Number(entry.attendanceScore || 0)
      const teamworkScore = Number(entry.teamworkScore || 0)
      const professionalismScore = Number(entry.professionalismScore || 0)
      const complianceScore = Number(entry.complianceScore || 0)
      const totalScore = Number(entry.totalScore || 0)
      const attendanceDetails = Array.isArray(entry.attendanceDetails)
        ? entry.attendanceDetails
        : []

      const categoryRows = [
        {
          category: 'attendance',
          score: Math.max(1, Math.min(5, attendanceScore / 10)),
          notes:
            attendanceDetails
              .map((d: any) => `${String(d?.condition || '').trim()} (${Number(d?.points || 0)})`)
              .filter(Boolean)
              .join('\n') || null,
          feedback: null,
        },
        {
          category: 'teamwork',
          score: Math.max(1, Math.min(5, teamworkScore / 2)),
          notes: null,
          feedback: null,
        },
        {
          category: 'technical_skills',
          score: Math.max(1, Math.min(5, professionalismScore / 4)),
          notes: null,
          feedback: null,
        },
        {
          category: 'soft_skills',
          score: Math.max(1, Math.min(5, complianceScore / 4)),
          notes: null,
          feedback: null,
        },
        {
          category: 'patient_satisfaction',
          score: Math.max(1, Math.min(5, totalScore / 20)),
          notes: null,
          feedback: null,
        },
      ]

      const categories = categoryRows.map((r) => r.category)
      await db
        .delete(performanceScores)
        .where(
          and(
            eq(performanceScores.staffId, staffMatch.id),
            eq(performanceScores.evaluationPeriod, evaluationPeriod),
            inArray(performanceScores.category, categories)
          )
        )

      await db.insert(performanceScores).values(
        categoryRows.map((row) => ({
          staffId: staffMatch.id,
          evaluationPeriod,
          category: row.category,
          score: row.score,
          notes: row.notes,
          feedback: row.feedback,
          evaluatedById: authUser.id,
        }))
      )

      written += 1
    }

    return c.json({
      success: true,
      data: {
        written,
        unresolved,
      },
    })
  } catch (error: unknown) {
    logError(error, { context: '[staff] Weekly performance batch error' })
    return c.json({ error: 'Failed to save weekly performance batch' }, 500)
  }
})

// ---------------------------------------------------------------------------
// Weekly Questionnaires (Admin create/manage)
// ---------------------------------------------------------------------------

app.get('/questionnaires', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.READ as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const data = await db.query.staffQuestionnaires.findMany({
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
    logError(error, { context: '[staff] GET /questionnaires error' })
    return c.json({ error: 'Failed to fetch questionnaires' }, 500)
  }
})

app.post('/questionnaires', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.CREATE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const body = await c.req.json()
    const name = String(body?.name || '').trim()
    if (!name) return c.json({ error: 'name is required' }, 400)

    const db = getDb(process.env.DATABASE_URL!)
    const [created] = await db
      .insert(staffQuestionnaires)
      .values({
        name,
        active: body?.active ?? true,
        createdById: authUser.id,
      })
      .returning()

    return c.json({ success: true, data: created })
  } catch (error: unknown) {
    logError(error, { context: '[staff] POST /questionnaires error' })
    return c.json({ error: 'Failed to create questionnaire' }, 500)
  }
})

app.patch('/questionnaires/:id', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.UPDATE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const id = c.req.param('id')
    const body = await c.req.json()
    const updates: any = { updatedAt: new Date() }

    if (body?.name !== undefined) {
      const nextName = String(body.name || '').trim()
      if (!nextName) return c.json({ error: 'name cannot be empty' }, 400)
      updates.name = nextName
    }
    if (body?.active !== undefined) updates.active = Boolean(body.active)
    if (body?.frequency !== undefined) {
      updates.frequency = body.frequency === 'one-time' ? 'one-time' : 'weekly'
    }

    const db = getDb(process.env.DATABASE_URL!)
    const [updated] = await db
      .update(staffQuestionnaires)
      .set(updates)
      .where(eq(staffQuestionnaires.id, id))
      .returning()

    if (!updated) return c.json({ error: 'Questionnaire not found' }, 404)
    return c.json({ success: true, data: updated })
  } catch (error: unknown) {
    logError(error, { context: '[staff] PATCH /questionnaires/:id error' })
    return c.json({ error: 'Failed to update questionnaire' }, 500)
  }
})

app.post('/questionnaires/:id/questions', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.UPDATE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const questionnaireId = c.req.param('id')
    const body = await c.req.json()
    const text = String(body?.text || '').trim()
    if (!text) return c.json({ error: 'text is required' }, 400)

    const db = getDb(process.env.DATABASE_URL!)
    const existing = await db.query.staffQuestionnaireQuestions.findMany({
      where: eq(staffQuestionnaireQuestions.questionnaireId, questionnaireId),
      orderBy: [desc(staffQuestionnaireQuestions.orderIndex)],
      limit: 1,
    })
    const nextOrder = (existing[0]?.orderIndex ?? -1) + 1

    const questionType = body?.questionType === 'multichoice' ? 'multichoice' : 'scale'
    const options: string[] =
      questionType === 'multichoice' && Array.isArray(body?.options)
        ? body.options.map((o: any) => String(o).trim()).filter(Boolean)
        : []

    const [created] = await db
      .insert(staffQuestionnaireQuestions)
      .values({
        questionnaireId,
        text,
        questionType,
        options,
        scale: body?.scale === '1-10' ? '1-10' : '1-5',
        orderIndex: nextOrder,
      })
      .returning()

    await db
      .update(staffQuestionnaires)
      .set({ updatedAt: new Date() })
      .where(eq(staffQuestionnaires.id, questionnaireId))

    return c.json({ success: true, data: created })
  } catch (error: unknown) {
    logError(error, { context: '[staff] POST /questionnaires/:id/questions error' })
    return c.json({ error: 'Failed to add question' }, 500)
  }
})

app.patch('/questionnaires/:id/questions/:questionId', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.UPDATE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const questionnaireId = c.req.param('id')
    const questionId = c.req.param('questionId')
    const body = await c.req.json()
    const updates: any = { updatedAt: new Date() }

    if (body?.text !== undefined) {
      const text = String(body.text || '').trim()
      if (!text) return c.json({ error: 'text cannot be empty' }, 400)
      updates.text = text
    }
    if (body?.questionType !== undefined) {
      updates.questionType = body.questionType === 'multichoice' ? 'multichoice' : 'scale'
    }
    if (body?.options !== undefined && Array.isArray(body.options)) {
      updates.options = body.options.map((o: any) => String(o).trim()).filter(Boolean)
    }

    const db = getDb(process.env.DATABASE_URL!)
    const [updated] = await db
      .update(staffQuestionnaireQuestions)
      .set(updates)
      .where(
        and(
          eq(staffQuestionnaireQuestions.id, questionId),
          eq(staffQuestionnaireQuestions.questionnaireId, questionnaireId)
        )
      )
      .returning()

    if (!updated) return c.json({ error: 'Question not found' }, 404)
    return c.json({ success: true, data: updated })
  } catch (error: unknown) {
    logError(error, { context: '[staff] PATCH /questionnaires/:id/questions/:questionId error' })
    return c.json({ error: 'Failed to update question' }, 500)
  }
})

app.delete('/questionnaires/:id', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.DELETE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const id = c.req.param('id')
    const db = getDb(process.env.DATABASE_URL!)
    const [deleted] = await db
      .delete(staffQuestionnaires)
      .where(eq(staffQuestionnaires.id, id))
      .returning()

    if (!deleted) return c.json({ error: 'Questionnaire group not found' }, 404)
    return c.json({ success: true })
  } catch (error: unknown) {
    logError(error, { context: '[staff] DELETE /questionnaires/:id error' })
    return c.json({ error: 'Failed to delete questionnaire group' }, 500)
  }
})

app.delete('/questionnaires/:id/questions/:questionId', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.UPDATE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const questionnaireId = c.req.param('id')
    const questionId = c.req.param('questionId')
    const db = getDb(process.env.DATABASE_URL!)

    const [deleted] = await db
      .delete(staffQuestionnaireQuestions)
      .where(
        and(
          eq(staffQuestionnaireQuestions.id, questionId),
          eq(staffQuestionnaireQuestions.questionnaireId, questionnaireId)
        )
      )
      .returning()

    if (!deleted) return c.json({ error: 'Question not found' }, 404)

    await db
      .update(staffQuestionnaires)
      .set({ updatedAt: new Date() })
      .where(eq(staffQuestionnaires.id, questionnaireId))

    return c.json({ success: true })
  } catch (error: unknown) {
    logError(error, { context: '[staff] DELETE /questionnaires/:id/questions/:questionId error' })
    return c.json({ error: 'Failed to delete question' }, 500)
  }
})

// ---------------------------------------------------------------------------
// Performance — monthly datatable (training scores + attendance %)
// ---------------------------------------------------------------------------

/** GET /performance/monthly — datatable for the redesigned Performance page. */
app.get('/performance/monthly', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.READ as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const month = c.req.query('month')
  const target = isValidMonth(month) ? month : defaultMonthYYYYMM()
  // Phase 5C — performance is internal-only. The legacy `?staffType=external`
  // option is preserved for backwards compatibility with any existing callers,
  // but the portal Performance page no longer exposes the filter.
  const staffTypeFilter = c.req.query('staffType') ?? 'internal'
  // Optional: scope the result to a single staff for the per-staff Performance tab.
  const staffIdFilter = c.req.query('staffId')
  const { start, endExclusive } = monthRangeUtc(target)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const filters = [] as any[]
    if (staffIdFilter) filters.push(eq(staff.id, staffIdFilter))
    if (!staffIdFilter && (staffTypeFilter === 'internal' || staffTypeFilter === 'external')) {
      filters.push(eq(staff.staffType, staffTypeFilter))
    }
    const staffWhere =
      filters.length === 0 ? undefined : filters.length === 1 ? filters[0] : and(...filters)
    const staffRows = await db
      .select({
        id: staff.id,
        fullName: staff.fullName,
        role: user.role,
        staffType: staff.staffType,
      })
      .from(staff)
      .leftJoin(user, eq(user.id, staff.userId))
      .where(staffWhere)

    if (staffRows.length === 0) {
      return c.json({ success: true, month: target, data: [] })
    }
    const staffIds = staffRows.map((s) => s.id)

    // HR clock-time corrections outrank the raw device punch, so performance
    // scoring must read them too — otherwise a day HR already fixed still
    // scores as late/absent here.
    const overridesByStaff = await fetchOverridesByStaff(
      db,
      staffIds,
      `${target}-01`,
      endExclusive.toISOString().slice(0, 10)
    )

    // Trainings completed in the month — score is 0..100 per row.
    const completions = await db
      .select({
        staffId: staffTrainingProgress.staffId,
        score: staffTrainingProgress.score,
        completedAt: staffTrainingProgress.completedAt,
      })
      .from(staffTrainingProgress)
      .where(
        and(
          inArray(staffTrainingProgress.staffId, staffIds),
          eq(staffTrainingProgress.status, 'completed'),
          gte(staffTrainingProgress.completedAt, start),
          lt(staffTrainingProgress.completedAt, endExclusive)
        )
      )
    const completionsByStaff = groupBy(completions, (c) => c.staffId)

    // Attendance events for the month
    const events = await db
      .select({
        staffId: attendanceEvents.staffId,
        eventTimestamp: attendanceEvents.eventTimestamp,
        createdAt: attendanceEvents.createdAt,
        sourceFile: attendanceEvents.sourceFile,
        deviceUserId: attendanceEvents.deviceUserId,
        deviceUserName: attendanceEvents.deviceUserName,
      })
      .from(attendanceEvents)
      .where(
        and(
          inArray(attendanceEvents.staffId, staffIds),
          gte(effectiveEventTsSql, start),
          lt(effectiveEventTsSql, endExclusive)
        )
      )
    const exceptions = await db
      .select()
      .from(attendanceExceptions)
      .where(
        and(
          inArray(attendanceExceptions.staffId, staffIds),
          gte(attendanceExceptions.date, target.concat('-01')),
          lt(attendanceExceptions.date, formatYMD(endExclusive))
        )
      )
    const approvedLeaves = await db
      .select({
        staffId: staffRequests.staffId,
        startDate: staffRequests.startDate,
        endDate: staffRequests.endDate,
      })
      .from(staffRequests)
      .where(
        and(
          inArray(staffRequests.staffId, staffIds),
          eq(staffRequests.requestType, 'leave'),
          eq(staffRequests.status, 'approved')
        )
      )

    const eventsByStaff = groupBy(events, (e) => e.staffId ?? '__unknown__')
    const exceptionsByStaff = groupBy(exceptions, (e) => e.staffId)
    const leavesByStaff = groupBy(approvedLeaves, (l) => l.staffId)

    // Phase 5C — drill attempts. Drills are training records with kind='drill'
    // and a `scoredMonth` per attempt (YYYY-MM). Multiple attempts in the same
    // month average together to produce the monthly drill score.
    const drillRows = await db
      .select({
        staffId: trainingAttempts.staffId,
        score: trainingAttempts.score,
      })
      .from(trainingAttempts)
      .innerJoin(trainingMaterials, eq(trainingMaterials.id, trainingAttempts.trainingId))
      .where(
        and(
          inArray(trainingAttempts.staffId, staffIds),
          eq(trainingMaterials.kind, 'drill'),
          eq(trainingAttempts.scoredMonth, target)
        )
      )
    const drillsByStaff = groupBy(drillRows, (r) => r.staffId)

    const data = staffRows.map((s) => {
      const cs = completionsByStaff.get(s.id) ?? []
      const trainingsCompleted = cs.length
      const trainingTotal = cs.reduce((acc, x) => acc + (x.score ?? 0), 0)
      const trainingMax = trainingsCompleted * 100
      const trainingScorePct =
        trainingMax === 0 ? null : Math.round((trainingTotal / trainingMax) * 1000) / 10

      const drills = drillsByStaff.get(s.id) ?? []
      const drillCount = drills.length
      const drillSum = drills.reduce((acc, d) => acc + (d.score ?? 0), 0)
      const drillScorePct = drillCount === 0 ? null : Math.round((drillSum / drillCount) * 10) / 10

      const staffEvents = (eventsByStaff.get(s.id) ?? []).map<LibAttendanceEvent>(toLibEvent)
      const staffExceptions = (exceptionsByStaff.get(s.id) ?? []).map<LibAttendanceException>(
        (e) => ({
          staffId: e.staffId,
          date: e.date,
          type: e.type as LibAttendanceException['type'],
          reason: e.reason,
        })
      )
      const staffLeaves = (leavesByStaff.get(s.id) ?? [])
        .filter((l): l is { staffId: string; startDate: Date; endDate: Date | null } =>
          Boolean(l.startDate)
        )
        .map<ApprovedLeave>((l) => ({
          staffId: l.staffId,
          startDate: l.startDate,
          endDate: l.endDate,
        }))
      const daily = dailySummaries({
        month: target,
        events: staffEvents,
        exceptions: staffExceptions,
        approvedLeaves: staffLeaves,
        overrides: overridesByStaff.get(s.id) ?? [],
      })
      const summary = monthlySummary({ month: target, daily })

      return {
        staffId: s.id,
        fullName: s.fullName,
        role: s.role,
        staffType: s.staffType,
        trainingsCompleted,
        trainingScorePct,
        trainingTotalPoints: trainingTotal,
        trainingMaxPoints: trainingMax,
        drillCount,
        drillScorePct,
        attendancePct: summary.attendancePct,
        daysPresent: summary.daysPresent,
        daysLate: summary.daysLate,
        daysAbsent: summary.daysAbsent,
      }
    })

    return c.json({ success: true, month: target, data })
  } catch (err: unknown) {
    logError(err, { context: '[performance/monthly]' })
    return c.json({ error: 'Failed to fetch monthly performance' }, 500)
  }
})

export { app as staffPerformanceApp }
