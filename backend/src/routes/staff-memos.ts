import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { staff, staffMemoAcknowledgements, staffMemos, user } from '../db/schema'
import { createAuditLog } from '../lib/audit'
import { sanitizeMemoBlocks, sanitizeMemoHtml } from '../lib/html-sanitize'
import { logError } from '../lib/logger'
import {
  isBroadcast,
  type MemoAudienceFilter,
  sanitizeAudienceFilter,
  summarizeAudience,
} from '../lib/memo-audience'
import { notifyMemoStaff } from '../lib/memo-notify'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const app = new Hono<HonoEnv>()

const MODULE = MODULES.STAFF

/** Extract an 11-char YouTube video id from watch / youtu.be / embed / shorts URLs. */
function parseYouTubeId(raw: string): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const m = raw.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  )
  if (m) return m[1]
  try {
    const v = new URL(raw).searchParams.get('v')
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v
  } catch {
    // not a URL
  }
  return null
}

// ── Memo audience helpers ──────────────────────────────────────────────────
//
// The pure helpers (sanitise / summarise / target check) live in
// `backend/src/lib/memo-audience.ts` so they're unit-testable without
// instantiating a DB. The DB-bound resolver below stays here.

/**
 * Resolve the active staff IDs targeted by a memo's audience filter.
 *
 * Empty filter (no roles/staffIds set) is treated as broadcast —
 * every active, non-deleted staff member is a target. Filters compose
 * additively: a staff member is in the audience if they match ANY of
 * roles or staffIds.
 */
async function resolveMemoAudienceIds(
  db: ReturnType<typeof getDb>,
  filter: MemoAudienceFilter
): Promise<string[]> {
  const broadcast = isBroadcast(filter)

  if (broadcast) {
    const rows = await db
      .select({ id: staff.id })
      .from(staff)
      .where(and(isNull(staff.deletedAt), eq(staff.status, 'active')))
    return rows.map((r) => r.id)
  }

  const conditions: any[] = []
  if (filter.roles?.length) {
    // Match via user.roleId
    conditions.push(inArray(user.roleId, filter.roles))
  }
  if (filter.staffIds?.length) {
    conditions.push(inArray(staff.id, filter.staffIds))
  }
  if (conditions.length === 0) return []

  const rows = await db
    .selectDistinct({ id: staff.id })
    .from(staff)
    .leftJoin(user, eq(user.id, staff.userId))
    .where(
      and(
        isNull(staff.deletedAt),
        eq(staff.status, 'active'),
        // OR across filter categories
        conditions.length === 1 ? conditions[0] : or(...conditions)
      )
    )
  return rows.map((r) => r.id)
}

// ---------------------------------------------------------------------------
// Memos (Admin create/manage)
// ---------------------------------------------------------------------------

app.get('/memos', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, authUser.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const memos = await db.query.staffMemos.findMany({
      orderBy: [desc(staffMemos.createdAt)],
    })

    // Per-memo target + acknowledged counts. We compute target counts by
    // resolving the audience filter; ack counts come from a single grouped
    // query so it stays cheap for a few-hundred memos × dozens of staff.
    const memoIds = memos.map((m) => m.id)
    let ackCounts = new Map<string, number>()
    if (memoIds.length > 0) {
      const rows = await db
        .select({
          memoId: staffMemoAcknowledgements.memoId,
          count: sql<number>`count(*)::int`,
        })
        .from(staffMemoAcknowledgements)
        .where(inArray(staffMemoAcknowledgements.memoId, memoIds))
        .groupBy(staffMemoAcknowledgements.memoId)
      ackCounts = new Map(rows.map((r) => [r.memoId, r.count]))
    }

    // Resolve target counts. Per-memo computation — cheap because the audience
    // filter is small and the active staff query is shared via the helper.
    const enriched = await Promise.all(
      memos.map(async (memo) => {
        const filter = (memo.audienceFilter ?? {}) as MemoAudienceFilter
        const targetIds = await resolveMemoAudienceIds(db, filter)
        return {
          ...memo,
          targetCount: targetIds.length,
          acknowledgedCount: ackCounts.get(memo.id) ?? 0,
        }
      })
    )

    return c.json({ success: true, data: enriched })
  } catch (error: unknown) {
    logError(error, { context: '[staff] GET /memos error' })
    return c.json({ error: 'Failed to fetch memos' }, 500)
  }
})

/** Get a single memo by id. */
app.get('/memos/:id{[0-9a-fA-F-]{36}}', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, authUser.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const id = c.req.param('id')
    const db = getDb(process.env.DATABASE_URL!)
    const memo = await db.query.staffMemos.findFirst({ where: eq(staffMemos.id, id) })
    if (!memo) return c.json({ error: 'Memo not found' }, 404)
    return c.json({ success: true, data: memo })
  } catch (error: unknown) {
    logError(error, { context: '[staff] GET /memos/:id error' })
    return c.json({ error: 'Failed to fetch memo' }, 500)
  }
})

/**
 * GET /memos/video-meta?url=... — resolve a YouTube URL to { id, title,
 * thumbnail, embedUrl } for the editor's video-embed preview. Done server-side
 * because YouTube's oEmbed endpoint isn't reliably CORS-enabled for the browser.
 */
app.get('/memos/video-meta', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const url = c.req.query('url') ?? ''
  const id = parseYouTubeId(url)
  if (!id) return c.json({ error: 'Not a recognised YouTube URL' }, 400)

  const embedUrl = `https://www.youtube.com/embed/${id}`
  const thumbnail = `https://img.youtube.com/vi/${id}/hqdefault.jpg`
  let title = 'YouTube video'
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(
        `https://www.youtube.com/watch?v=${id}`
      )}`
    )
    if (res.ok) {
      const data = (await res.json()) as { title?: string }
      if (data.title) title = data.title
    }
  } catch (error: unknown) {
    logError(error, { context: '[staff] GET /memos/video-meta oembed' })
  }

  return c.json({ success: true, data: { id, title, thumbnail, embedUrl } })
})

app.post('/memos', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, authUser.id, MODULE as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const body = await c.req.json()
    const db = getDb(process.env.DATABASE_URL!)

    const audienceFilter = sanitizeAudienceFilter(body.audienceFilter)
    const [memo] = await db
      .insert(staffMemos)
      .values({
        title: body.title,
        audience: body.audience || summarizeAudience(audienceFilter),
        audienceFilter,
        level: body.level || 'info',
        memoType: ['general', 'announcement', 'notice', 'meeting_memo'].includes(body.memoType)
          ? body.memoType
          : 'general',
        content: sanitizeMemoHtml(body.content),
        blocks: sanitizeMemoBlocks(body.blocks || []) as any,
        published: body.published ?? false,
        publishedAt: body.published ? new Date() : null,
        createdById: authUser.id,
      })
      .returning()

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: authUser.id,
      action: 'memo_created',
      module: 'staff',
      entityId: memo.id,
      entityName: memo.title,
      afterJson: {
        title: memo.title,
        audience: memo.audience,
        level: memo.level,
        published: memo.published,
      },
    })

    return c.json({ success: true, data: memo })
  } catch (error: unknown) {
    logError(error, { context: '[staff] POST /memos error' })
    return c.json({ error: 'Failed to create memo' }, 500)
  }
})

app.patch('/memos/:id', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, authUser.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const id = c.req.param('id')
    const body = await c.req.json()
    const db = getDb(process.env.DATABASE_URL!)

    const existing = await db.query.staffMemos.findFirst({ where: eq(staffMemos.id, id) })
    if (!existing) return c.json({ error: 'Memo not found' }, 404)

    const audienceFilter = sanitizeAudienceFilter(body.audienceFilter)
    // Keep the original publish timestamp when editing an already-live memo;
    // only stamp a fresh one on a draft→published transition.
    const publishedAt = body.published ? (existing.publishedAt ?? new Date()) : null
    const [updated] = await db
      .update(staffMemos)
      .set({
        title: body.title,
        audience: body.audience || summarizeAudience(audienceFilter),
        audienceFilter,
        level: body.level,
        memoType: ['general', 'announcement', 'notice', 'meeting_memo'].includes(body.memoType)
          ? body.memoType
          : 'general',
        content: sanitizeMemoHtml(body.content),
        blocks: sanitizeMemoBlocks(body.blocks) as any,
        published: body.published,
        publishedAt,
        updatedAt: new Date(),
      })
      .where(eq(staffMemos.id, id))
      .returning()

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: authUser.id,
      action: 'memo_updated',
      module: 'staff',
      entityId: id,
      entityName: updated.title,
      beforeJson: {
        title: existing.title,
        audience: existing.audience,
        level: existing.level,
        published: existing.published,
      },
      afterJson: {
        title: updated.title,
        audience: updated.audience,
        level: updated.level,
        published: updated.published,
      },
    })

    return c.json({ success: true, data: updated })
  } catch (error: unknown) {
    logError(error, { context: '[staff] PATCH /memos/:id error' })
    return c.json({ error: 'Failed to update memo' }, 500)
  }
})

app.delete('/memos/:id', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, authUser.id, MODULE as string, ACTIONS.DELETE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const id = c.req.param('id')
    const db = getDb(process.env.DATABASE_URL!)
    const existing = await db.query.staffMemos.findFirst({ where: eq(staffMemos.id, id) })
    await db.delete(staffMemos).where(eq(staffMemos.id, id))

    if (existing) {
      c.set('skipAudit', true)
      await createAuditLog(db, {
        userId: authUser.id,
        action: 'memo_deleted',
        module: 'staff',
        entityId: id,
        entityName: existing.title,
      })
    }
    return c.json({ success: true })
  } catch (error: unknown) {
    logError(error, { context: '[staff] DELETE /memos/:id error' })
    return c.json({ error: 'Failed to delete memo' }, 500)
  }
})

app.patch('/memos/:id/publish', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, authUser.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const id = c.req.param('id')
    const body = await c.req.json()
    const db = getDb(process.env.DATABASE_URL!)

    const existing = await db.query.staffMemos.findFirst({ where: eq(staffMemos.id, id) })
    if (!existing) return c.json({ error: 'Memo not found' }, 404)

    const publishing = Boolean(body.published)
    const [updated] = await db
      .update(staffMemos)
      .set({
        published: publishing,
        publishedAt: publishing ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(staffMemos.id, id))
      .returning()

    // Notify the audience the first time a memo goes live (draft → published).
    // Re-publishing an already-live memo doesn't re-blast; that's what the
    // explicit "notify unread" nudge below is for. Best-effort — never blocks
    // the response.
    let notified: { pushed: number; texted: number } | undefined
    if (publishing && !existing.published) {
      const filter = (updated.audienceFilter ?? {}) as MemoAudienceFilter
      const targetIds = await resolveMemoAudienceIds(db, filter)
      notified = await notifyMemoStaff(
        db,
        { id: updated.id, title: updated.title, level: updated.level },
        targetIds
      ).catch((err) => {
        logError(err, { context: '[staff] memo publish notify' })
        return undefined
      })
    }

    return c.json({ success: true, data: updated, notified })
  } catch (error: unknown) {
    logError(error, { context: '[staff] PATCH /memos/:id/publish error' })
    return c.json({ error: 'Failed to publish memo' }, 500)
  }
})

/**
 * POST /memos/:id/notify-unread — re-notify only the target staff who have NOT
 * yet acknowledged a published memo (a manual nudge from the read-receipt view).
 */
app.post('/memos/:id/notify-unread', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, authUser.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const id = c.req.param('id')
    const db = getDb(process.env.DATABASE_URL!)

    const memo = await db.query.staffMemos.findFirst({ where: eq(staffMemos.id, id) })
    if (!memo) return c.json({ error: 'Memo not found' }, 404)
    if (!memo.published) return c.json({ error: 'Memo is not published yet' }, 400)

    const filter = (memo.audienceFilter ?? {}) as MemoAudienceFilter
    const targetIds = await resolveMemoAudienceIds(db, filter)
    if (targetIds.length === 0) {
      return c.json({ success: true, data: { pushed: 0, texted: 0, pending: 0 } })
    }

    const acked = await db
      .select({ staffId: staffMemoAcknowledgements.staffId })
      .from(staffMemoAcknowledgements)
      .where(
        and(
          eq(staffMemoAcknowledgements.memoId, id),
          inArray(staffMemoAcknowledgements.staffId, targetIds)
        )
      )
    const ackedSet = new Set(acked.map((a) => a.staffId))
    const unreadIds = targetIds.filter((tid) => !ackedSet.has(tid))

    const notified = await notifyMemoStaff(
      db,
      { id: memo.id, title: memo.title, level: memo.level },
      unreadIds,
      { reminder: true }
    )

    return c.json({ success: true, data: { ...notified, pending: unreadIds.length } })
  } catch (error: unknown) {
    logError(error, { context: '[staff] POST /memos/:id/notify-unread error' })
    return c.json({ error: 'Failed to notify unread staff' }, 500)
  }
})

/**
 * GET /memos/:id/acknowledgements — admin read-receipt view.
 * Returns audience-target count + acknowledged-count + per-staff rows.
 */
app.get('/memos/:id/acknowledgements', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, authUser.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const id = c.req.param('id')
    const db = getDb(process.env.DATABASE_URL!)

    const memo = await db.query.staffMemos.findFirst({ where: eq(staffMemos.id, id) })
    if (!memo) return c.json({ error: 'Memo not found' }, 404)

    const filter = (memo.audienceFilter ?? {}) as MemoAudienceFilter
    const targetIds = await resolveMemoAudienceIds(db, filter)

    const acks =
      targetIds.length === 0
        ? []
        : await db
            .select({
              id: staffMemoAcknowledgements.id,
              staffId: staffMemoAcknowledgements.staffId,
              acknowledgedAt: staffMemoAcknowledgements.acknowledgedAt,
              staffName: staff.fullName,
            })
            .from(staffMemoAcknowledgements)
            .innerJoin(staff, eq(staff.id, staffMemoAcknowledgements.staffId))
            .where(
              and(
                eq(staffMemoAcknowledgements.memoId, id),
                inArray(staffMemoAcknowledgements.staffId, targetIds)
              )
            )
            .orderBy(desc(staffMemoAcknowledgements.acknowledgedAt))

    const ackIds = new Set(acks.map((a) => a.staffId))
    const pending =
      targetIds.length === 0
        ? []
        : await db
            .select({ id: staff.id, name: staff.fullName })
            .from(staff)
            .where(
              and(
                inArray(
                  staff.id,
                  targetIds.filter((tid) => !ackIds.has(tid))
                ),
                isNull(staff.deletedAt)
              )
            )
            .orderBy(staff.fullName)

    return c.json({
      success: true,
      data: {
        memoId: id,
        targetCount: targetIds.length,
        acknowledgedCount: acks.length,
        acknowledged: acks,
        pending,
      },
    })
  } catch (error: unknown) {
    logError(error, { context: '[staff] GET /memos/:id/acknowledgements error' })
    return c.json({ error: 'Failed to load acknowledgements' }, 500)
  }
})

export { app as staffMemosApp, resolveMemoAudienceIds }
