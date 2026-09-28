/**
 * Upstash QStash engine.
 *
 * On boot, reconciles the QStash Schedules API against our local registry:
 *   - creates a schedule for any registered job that doesn't have one
 *   - updates the cron expression or destination URL if they drifted
 *   - deletes schedules that point at jobs no longer in the registry
 *
 * Each schedule POSTs to `${publicBaseUrl}/api/internal/cron/:jobId`. Incoming
 * requests are verified against the QStash signing key in the route handler.
 */

import { getUpstashConfig } from '../../integrations'
import { logger } from '../../logger'
import { normalizeQstashBase } from '../qstash-url'
import { CRON_JOBS } from '../registry'

interface QStashSchedule {
  scheduleId: string
  destination: string
  cron: string
}

/**
 * Can QStash actually deliver to this base URL?
 *
 * QStash is an external service, so the destination must be absolute, http(s),
 * and not a loopback/private address. Local dev configs routinely fail all
 * three — that is expected, not an error worth shouting about on every boot.
 */
function describeDestination(raw: string): { usable: boolean; reason?: string } {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return { usable: false, reason: 'not an absolute URL (missing http:// or https://)' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { usable: false, reason: `unsupported scheme "${url.protocol}"` }
  }
  const host = url.hostname.toLowerCase()
  const isLoopback =
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  if (isLoopback) {
    return { usable: false, reason: 'loopback/private host is unreachable from QStash' }
  }
  return { usable: true }
}

export async function syncQStashSchedules(): Promise<{
  created: number
  updated: number
  deleted: number
  skipped: number
}> {
  const cfg = await getUpstashConfig()
  if (!cfg?.qstashToken || !cfg?.publicBaseUrl) {
    logger.info('[cron:qstash] not configured — skipping schedule sync')
    return { created: 0, updated: 0, deleted: 0, skipped: CRON_JOBS.length }
  }

  // QStash calls us from the public internet, so the destination must be an
  // absolute http(s) URL it can actually reach. Without this check a
  // scheme-less or localhost value is sent anyway and QStash rejects the whole
  // sync with `400 invalid destination url`, logged at error level on EVERY
  // boot. Neither case is recoverable at runtime, so skip quietly instead.
  const reachability = describeDestination(cfg.publicBaseUrl)
  if (!reachability.usable) {
    logger.info(
      { publicBaseUrl: cfg.publicBaseUrl, reason: reachability.reason },
      '[cron:qstash] destination not publicly reachable — skipping schedule sync'
    )
    return { created: 0, updated: 0, deleted: 0, skipped: CRON_JOBS.length }
  }

  const baseUrl = cfg.publicBaseUrl.replace(/\/$/, '')
  const qstashBase = normalizeQstashBase(cfg.qstashBaseUrl)
  const existing = await listSchedules(qstashBase, cfg.qstashToken)

  // Index existing schedules by their destination URL — the URL is our identity.
  const byDestination = new Map<string, QStashSchedule>()
  for (const s of existing) {
    byDestination.set(s.destination, s)
  }

  let created = 0
  let updated = 0
  let deleted = 0

  // Optional failure callback so a delivery failure surfaces in our own
  // cron_job_runs table rather than only in the QStash DLQ.
  const failureCallback = `${baseUrl}/api/internal/cron/_failure-callback`

  for (const job of CRON_JOBS) {
    const destination = `${baseUrl}/api/internal/cron/${job.id}`
    const found = byDestination.get(destination)
    byDestination.delete(destination)
    if (!found) {
      const scheduleId = await createSchedule(
        qstashBase,
        cfg.qstashToken,
        destination,
        job.cron,
        failureCallback
      )
      created++
      logger.info({ jobId: job.id, cron: job.cron, scheduleId }, '[cron:qstash] created schedule')
      continue
    }
    if (found.cron !== job.cron) {
      // QStash schedules can't be updated in-place — delete + re-create.
      await deleteSchedule(qstashBase, cfg.qstashToken, found.scheduleId)
      const scheduleId = await createSchedule(
        qstashBase,
        cfg.qstashToken,
        destination,
        job.cron,
        failureCallback
      )
      updated++
      logger.info(
        { jobId: job.id, from: found.cron, to: job.cron, scheduleId },
        '[cron:qstash] updated schedule'
      )
    }
  }

  // Anything left in the map points at our base URL but isn't in the registry —
  // delete it so we don't leave orphan schedules firing into 404s.
  const baseUrlPrefix = `${baseUrl}/api/internal/cron/`
  for (const orphan of byDestination.values()) {
    if (!orphan.destination.startsWith(baseUrlPrefix)) continue
    await deleteSchedule(qstashBase, cfg.qstashToken, orphan.scheduleId)
    deleted++
    logger.info({ destination: orphan.destination }, '[cron:qstash] deleted orphan schedule')
  }

  return { created, updated, deleted, skipped: 0 }
}

async function listSchedules(qstashBase: string, token: string): Promise<QStashSchedule[]> {
  const res = await fetch(`${qstashBase}/schedules`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    logger.warn({ status: res.status }, '[cron:qstash] list schedules failed')
    return []
  }
  const body = (await res.json()) as Array<{
    scheduleId: string
    destination: string
    cron: string
  }>
  return body.map((s) => ({ scheduleId: s.scheduleId, destination: s.destination, cron: s.cron }))
}

async function createSchedule(
  qstashBase: string,
  token: string,
  destination: string,
  cronExpr: string,
  failureCallback?: string
): Promise<string | null> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Upstash-Cron': cronExpr,
    'Content-Type': 'application/json',
  }
  if (failureCallback) headers['Upstash-Failure-Callback'] = failureCallback

  const res = await fetch(`${qstashBase}/schedules/${encodeURIComponent(destination)}`, {
    method: 'POST',
    headers,
    // Empty JSON object so the destination receives a parseable body.
    body: '{}',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`QStash createSchedule failed: ${res.status} ${text}`)
  }
  // Capture the returned scheduleId so callers can delete by ID rather than
  // by destination-match. Body shape: `{ "scheduleId": "scd_xxx" }`.
  try {
    const body = (await res.json()) as { scheduleId?: string }
    return body.scheduleId ?? null
  } catch {
    return null
  }
}

async function deleteSchedule(
  qstashBase: string,
  token: string,
  scheduleId: string
): Promise<void> {
  const res = await fetch(`${qstashBase}/schedules/${encodeURIComponent(scheduleId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok && res.status !== 404) {
    logger.warn({ scheduleId, status: res.status }, '[cron:qstash] delete failed')
  }
}
