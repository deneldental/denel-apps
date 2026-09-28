/**
 * Cron "pipeline" view — what's coming next for each registered job, plus a
 * live snapshot of the QStash delivery feed when QStash is configured.
 *
 * Two sources are joined in the response:
 *   1. **Local computed**: next-N fire times derived from each job's cron
 *      expression. Engine-agnostic — works whether node-cron, QStash, or both
 *      are enabled. Always available.
 *   2. **QStash live**: schedules QStash holds + the most recent events from
 *      the QStash event feed (created / active / delivered / failed / retry).
 *      Only populated when QStash is configured. This is what
 *      console.upstash.com/qstash shows in the "Events" tab.
 *
 * The frontend renders both side-by-side so the admin can see the registry's
 * intent + what the queue is actually doing.
 *
 * Implementation notes — caught by an audit against the official Upstash
 * docs (https://upstash.com/docs/qstash/api-reference):
 *   - `/v2/messages` is a *single-message* endpoint, not a list. We use
 *     `/v2/events` instead, which is the canonical "what has happened" feed.
 *   - QStash returns timestamps as int64 unix millis; we normalise to ISO.
 */

import { CronExpressionParser } from 'cron-parser'
import { getUpstashConfig } from '../integrations'
import { logger } from '../logger'
import { normalizeQstashBase } from './qstash-url'
import { CRON_JOBS } from './registry'

export interface NextRun {
  jobId: string
  cron: string
  nextRuns: string[] // ISO timestamps, next 3 fire times
}

/**
 * One event from QStash's `/v2/events` feed. Replaces the (non-existent)
 * `/v2/messages` list endpoint that earlier code incorrectly assumed.
 */
export interface QStashEvent {
  messageId: string
  url: string
  /** Documented states: 'CREATED' | 'ACTIVE' | 'DELIVERED' | 'FAILED' | 'RETRY'. */
  state: string
  /** When the event happened (ISO, normalised from QStash's unix-millis). */
  time: string
  /** Only set for schedule-triggered fires. */
  scheduleId: string | null
  /** Next-attempt time when state='RETRY' (ISO). */
  nextDeliveryTime: string | null
  /** Destination error when state='FAILED'. */
  error: string | null
}

export interface QStashLiveSchedule {
  scheduleId: string
  destination: string
  cron: string
  createdAt: string
  /** Resolved from the registry by URL match. Null when destination doesn't map. */
  matchedJobId: string | null
  /** Optional next-fire time QStash predicts (ISO). */
  nextScheduleTime: string | null
  isPaused: boolean
}

export interface PipelineSnapshot {
  nextRuns: NextRun[]
  qstash: {
    configured: boolean
    schedules: QStashLiveSchedule[]
    /** Recent events filtered to our backend's destinations. */
    events: QStashEvent[]
    error: string | null
  }
}

export async function buildPipelineSnapshot(): Promise<PipelineSnapshot> {
  const nextRuns: NextRun[] = CRON_JOBS.map((job) => ({
    jobId: job.id,
    cron: job.cron,
    nextRuns: computeNextRuns(job.cron, 3),
  }))

  const cfg = await getUpstashConfig()
  if (!cfg?.qstashToken) {
    return {
      nextRuns,
      qstash: { configured: false, schedules: [], events: [], error: null },
    }
  }

  const baseUrl = (cfg.publicBaseUrl ?? '').replace(/\/$/, '')
  const jobUrlPrefix = baseUrl ? `${baseUrl}/api/internal/cron/` : null

  // Build a registry-ID lookup keyed by the URL QStash would call.
  const jobIdByUrl = new Map<string, string>()
  if (jobUrlPrefix) {
    for (const job of CRON_JOBS) {
      jobIdByUrl.set(`${jobUrlPrefix}${job.id}`, job.id)
    }
  }

  const qstashBase = normalizeQstashBase(cfg.qstashBaseUrl)

  try {
    const [schedules, events] = await Promise.all([
      fetchSchedules(qstashBase, cfg.qstashToken),
      fetchEvents(qstashBase, cfg.qstashToken),
    ])
    return {
      nextRuns,
      qstash: {
        configured: true,
        schedules: schedules.map((s) => ({
          scheduleId: s.scheduleId,
          destination: s.destination,
          cron: s.cron,
          createdAt: s.createdAt,
          matchedJobId: jobIdByUrl.get(s.destination) ?? null,
          nextScheduleTime: s.nextScheduleTime,
          isPaused: s.isPaused,
        })),
        events: jobUrlPrefix ? events.filter((e) => e.url.startsWith(jobUrlPrefix)) : events,
        error: null,
      },
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    logger.warn({ err: error }, '[cron-pipeline] qstash fetch failed')
    return {
      nextRuns,
      qstash: { configured: true, schedules: [], events: [], error },
    }
  }
}

function computeNextRuns(cronExpr: string, count: number): string[] {
  try {
    const it = CronExpressionParser.parse(cronExpr, {
      currentDate: new Date(),
      tz: 'UTC',
    })
    const out: string[] = []
    for (let i = 0; i < count; i++) {
      out.push(it.next().toDate().toISOString())
    }
    return out
  } catch (err) {
    logger.warn({ cronExpr, err: (err as Error).message }, '[cron-pipeline] parse failed')
    return []
  }
}

interface RawSchedule {
  scheduleId: string
  destination: string
  cron: string
  createdAt: number | string
  nextScheduleTime?: number | string | null
  isPaused?: boolean
}

async function fetchSchedules(
  qstashBase: string,
  token: string
): Promise<
  Array<{
    scheduleId: string
    destination: string
    cron: string
    createdAt: string
    nextScheduleTime: string | null
    isPaused: boolean
  }>
> {
  const res = await fetch(`${qstashBase}/schedules`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new Error(`QStash schedules list ${res.status}: ${await res.text().catch(() => '')}`)
  }
  const body = (await res.json()) as RawSchedule[]
  return body.map((s) => ({
    scheduleId: s.scheduleId,
    destination: s.destination,
    cron: s.cron,
    createdAt: normaliseTimestamp(s.createdAt) ?? new Date().toISOString(),
    nextScheduleTime: normaliseTimestamp(s.nextScheduleTime ?? null),
    isPaused: !!s.isPaused,
  }))
}

interface RawEvent {
  messageId: string
  url: string
  state?: string
  time?: number | string
  scheduleId?: string | null
  nextDeliveryTime?: number | string | null
  error?: string | null
}

async function fetchEvents(qstashBase: string, token: string): Promise<QStashEvent[]> {
  // GET /v2/events — paginated; we take the default first page (max ~1000
  // per QStash defaults, which is more than enough for the UI). Response is
  // either `{ events: [...], cursor: "..." }` or — historically — a bare
  // array. Handle both defensively.
  const res = await fetch(`${qstashBase}/events`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    // 404 means the project has no event history yet.
    if (res.status === 404) return []
    throw new Error(`QStash events list ${res.status}: ${await res.text().catch(() => '')}`)
  }
  const body = await res.json()
  const raw: RawEvent[] = Array.isArray(body)
    ? (body as RawEvent[])
    : ((body as { events?: RawEvent[] }).events ?? [])
  return raw.map((e) => ({
    messageId: e.messageId,
    url: e.url,
    state: e.state ?? 'UNKNOWN',
    time: normaliseTimestamp(e.time ?? null) ?? new Date().toISOString(),
    scheduleId: e.scheduleId ?? null,
    nextDeliveryTime: normaliseTimestamp(e.nextDeliveryTime ?? null),
    error: e.error ?? null,
  }))
}

function normaliseTimestamp(ts: number | string | null | undefined): string | null {
  if (ts == null) return null
  if (typeof ts === 'number') return new Date(ts).toISOString()
  // Some QStash responses return string-encoded millis; coerce safely.
  const n = Number(ts)
  if (Number.isFinite(n) && n > 1e12) return new Date(n).toISOString()
  return ts
}
