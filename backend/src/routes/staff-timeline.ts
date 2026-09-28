/**
 * Staff timeline — a read-time aggregation (no dedicated table). Unions the
 * staff-related event sources, sorts newest-first, and paginates the merged
 * list. Each source is capped so one high-volume source (attendance) can't
 * starve the others; `total`/`hasMore` reflect the merged (capped) set.
 */

import { and, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import {
  attendanceEvents,
  staffDocuments,
  staffLifecycleTasks,
  staffMemoAcknowledgements,
  staffMemos,
  staffRequests,
  staffTrainingProgress,
  taskAssignments,
  tasks,
  trainingAttempts,
  trainingMaterials,
} from '../db/schema'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const staffTimelineApp = new Hono<HonoEnv>()

export type TimelineEventType =
  | 'attendance'
  | 'document'
  | 'training'
  | 'assessment'
  | 'request'
  | 'lifecycle'
  | 'task'
  | 'memo'

interface TimelineEvent {
  id: string
  eventType: TimelineEventType
  title: string
  description: string | null
  timestamp: string
}

const PER_SOURCE_CAP = 200
const ATTENDANCE_CAP = 500

function iso(d: Date | null | undefined): string | null {
  return d ? new Date(d).toISOString() : null
}

function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

staffTimelineApp.get('/:staffId', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.STAFF as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const staffId = c.req.param('staffId')
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 50, 1), 200)
  const offset = Math.max(Number(c.req.query('offset')) || 0, 0)

  try {
    const db = getDb(process.env.DATABASE_URL!)

    const [attendance, documents, completions, attempts, requests, lifecycle, taskRows, memoAcks] =
      await Promise.all([
        db
          .select({
            id: attendanceEvents.id,
            ts: attendanceEvents.eventTimestamp,
            rawStatus: attendanceEvents.rawStatus,
          })
          .from(attendanceEvents)
          .where(eq(attendanceEvents.staffId, staffId))
          .orderBy(desc(attendanceEvents.eventTimestamp))
          .limit(ATTENDANCE_CAP),
        db
          .select({
            id: staffDocuments.id,
            ts: staffDocuments.uploadedAt,
            title: staffDocuments.title,
            documentType: staffDocuments.documentType,
          })
          .from(staffDocuments)
          .where(eq(staffDocuments.staffId, staffId))
          .orderBy(desc(staffDocuments.uploadedAt))
          .limit(PER_SOURCE_CAP),
        db
          .select({
            id: staffTrainingProgress.id,
            ts: staffTrainingProgress.completedAt,
            score: staffTrainingProgress.score,
            title: trainingMaterials.title,
          })
          .from(staffTrainingProgress)
          .innerJoin(trainingMaterials, eq(staffTrainingProgress.trainingId, trainingMaterials.id))
          .where(
            and(
              eq(staffTrainingProgress.staffId, staffId),
              eq(staffTrainingProgress.status, 'completed')
            )
          )
          .orderBy(desc(staffTrainingProgress.completedAt))
          .limit(PER_SOURCE_CAP),
        db
          .select({
            id: trainingAttempts.id,
            ts: trainingAttempts.submittedAt,
            score: trainingAttempts.score,
            passed: trainingAttempts.passed,
            attemptNumber: trainingAttempts.attemptNumber,
            title: trainingMaterials.title,
          })
          .from(trainingAttempts)
          .innerJoin(trainingMaterials, eq(trainingAttempts.trainingId, trainingMaterials.id))
          .where(eq(trainingAttempts.staffId, staffId))
          .orderBy(desc(trainingAttempts.submittedAt))
          .limit(PER_SOURCE_CAP),
        db
          .select({
            id: staffRequests.id,
            ts: staffRequests.submittedAt,
            createdAt: staffRequests.createdAt,
            requestType: staffRequests.requestType,
            subType: staffRequests.subType,
            status: staffRequests.status,
          })
          .from(staffRequests)
          .where(eq(staffRequests.staffId, staffId))
          .orderBy(desc(staffRequests.submittedAt))
          .limit(PER_SOURCE_CAP),
        db
          .select({
            id: staffLifecycleTasks.id,
            ts: staffLifecycleTasks.completedAt,
            kind: staffLifecycleTasks.kind,
            label: staffLifecycleTasks.label,
          })
          .from(staffLifecycleTasks)
          .where(
            and(
              eq(staffLifecycleTasks.staffId, staffId),
              eq(staffLifecycleTasks.status, 'completed')
            )
          )
          .orderBy(desc(staffLifecycleTasks.completedAt))
          .limit(PER_SOURCE_CAP),
        db
          .select({
            id: taskAssignments.id,
            ts: taskAssignments.createdAt,
            doneAt: taskAssignments.doneAt,
            status: taskAssignments.status,
            title: tasks.title,
          })
          .from(taskAssignments)
          .innerJoin(tasks, eq(taskAssignments.taskId, tasks.id))
          .where(eq(taskAssignments.staffId, staffId))
          .orderBy(desc(taskAssignments.createdAt))
          .limit(PER_SOURCE_CAP),
        db
          .select({
            id: staffMemoAcknowledgements.id,
            ts: staffMemoAcknowledgements.acknowledgedAt,
            title: staffMemos.title,
          })
          .from(staffMemoAcknowledgements)
          .innerJoin(staffMemos, eq(staffMemoAcknowledgements.memoId, staffMemos.id))
          .where(eq(staffMemoAcknowledgements.staffId, staffId))
          .orderBy(desc(staffMemoAcknowledgements.acknowledgedAt))
          .limit(PER_SOURCE_CAP),
      ])

    const events: TimelineEvent[] = []

    for (const a of attendance) {
      if (!a.ts) continue
      events.push({
        id: `att-${a.id}`,
        eventType: 'attendance',
        title: 'Attendance punch',
        description: a.rawStatus ? titleCase(a.rawStatus) : null,
        timestamp: iso(a.ts) as string,
      })
    }
    for (const d of documents) {
      if (!d.ts) continue
      events.push({
        id: `doc-${d.id}`,
        eventType: 'document',
        title: `Document uploaded: ${d.title}`,
        description: d.documentType ? titleCase(d.documentType) : null,
        timestamp: iso(d.ts) as string,
      })
    }
    for (const t of completions) {
      if (!t.ts) continue
      events.push({
        id: `trn-${t.id}`,
        eventType: 'training',
        title: `Completed training: ${t.title}`,
        description: t.score != null ? `Score ${t.score}` : null,
        timestamp: iso(t.ts) as string,
      })
    }
    for (const a of attempts) {
      if (!a.ts) continue
      events.push({
        id: `att2-${a.id}`,
        eventType: 'assessment',
        title: `Assessment: ${a.title}`,
        description: `Attempt ${a.attemptNumber}${a.score != null ? ` · score ${a.score}` : ''} · ${a.passed ? 'passed' : 'not passed'}`,
        timestamp: iso(a.ts) as string,
      })
    }
    for (const r of requests) {
      const ts = r.ts ?? r.createdAt
      if (!ts) continue
      events.push({
        id: `req-${r.id}`,
        eventType: 'request',
        title: `${titleCase(r.subType || r.requestType)} request`,
        description: titleCase(r.status),
        timestamp: iso(ts) as string,
      })
    }
    for (const l of lifecycle) {
      if (!l.ts) continue
      events.push({
        id: `lct-${l.id}`,
        eventType: 'lifecycle',
        title: l.label,
        description: titleCase(l.kind),
        timestamp: iso(l.ts) as string,
      })
    }
    for (const t of taskRows) {
      const ts = t.doneAt ?? t.ts
      if (!ts) continue
      events.push({
        id: `tsk-${t.id}`,
        eventType: 'task',
        title: `Task: ${t.title}`,
        description: t.status === 'done' ? 'Completed' : 'Assigned',
        timestamp: iso(ts) as string,
      })
    }
    for (const m of memoAcks) {
      if (!m.ts) continue
      events.push({
        id: `mem-${m.id}`,
        eventType: 'memo',
        title: `Acknowledged memo: ${m.title}`,
        description: null,
        timestamp: iso(m.ts) as string,
      })
    }

    events.sort((x, y) => y.timestamp.localeCompare(x.timestamp))
    const page = events.slice(offset, offset + limit)

    return c.json({
      success: true,
      data: {
        events: page,
        total: events.length,
        hasMore: offset + limit < events.length,
      },
    })
  } catch (err: unknown) {
    logError(err, { context: '[staff-timeline]' })
    return c.json({ error: 'Failed to build staff timeline' }, 500)
  }
})

export { staffTimelineApp }
