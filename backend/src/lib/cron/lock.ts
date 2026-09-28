/**
 * Distributed lock for cron jobs.
 *
 * Uses Upstash Redis REST API (`SET key val NX EX seconds`). When Redis isn't
 * configured (dev), the lock is a no-op — that's fine for single-instance dev.
 *
 * The lock key is `cron:lock:<jobId>` and the value is the firing instance's
 * UUID, so a stale holder can be detected without a clock dependency.
 */

import { randomUUID } from 'node:crypto'
import { getUpstashConfig } from '../integrations'
import { logger } from '../logger'

const KEY_PREFIX = 'cron:lock:'

export interface LockHandle {
  jobId: string
  token: string
  /** Release the lock; safe to call multiple times. */
  release: () => Promise<void>
}

export async function acquireLock(jobId: string, ttlSeconds: number): Promise<LockHandle | null> {
  const cfg = await getUpstashConfig()
  if (!cfg?.redisRestUrl || !cfg?.redisRestToken) {
    // No Redis configured — return a no-op handle so callers don't have to
    // special-case dev. Single-instance prod still works.
    return {
      jobId,
      token: 'no-redis',
      release: async () => {},
    }
  }

  const token = randomUUID()
  const key = KEY_PREFIX + jobId
  // Upstash REST API: pipeline form lets us do SET NX EX in one round-trip.
  const url = `${cfg.redisRestUrl.replace(/\/$/, '')}/set/${encodeURIComponent(key)}/${encodeURIComponent(token)}?NX=true&EX=${ttlSeconds}`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.redisRestToken}` },
    })
    if (!res.ok) {
      logger.error(
        { jobId, status: res.status },
        '[cron-lock] Redis acquire failed — job will be skipped this tick'
      )
      return null
    }
    const body = (await res.json()) as { result: string | null }
    // `result === 'OK'` means we got it; `null` means another worker holds it.
    if (body.result !== 'OK') return null
    return {
      jobId,
      token,
      release: async () => {
        await releaseLock(cfg.redisRestUrl, cfg.redisRestToken, key, token)
      },
    }
  } catch (err) {
    logger.error(
      { jobId, err: (err as Error).message },
      '[cron-lock] Redis unreachable — job will be skipped this tick'
    )
    return null
  }
}

async function releaseLock(
  baseUrl: string,
  bearer: string,
  key: string,
  token: string
): Promise<void> {
  // Lua: DEL only if value matches our token (prevents releasing someone else's lock).
  const script =
    'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end'
  const url = `${baseUrl.replace(/\/$/, '')}/eval`
  try {
    await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ script, keys: [key], args: [token] }),
    })
  } catch (err) {
    logger.warn({ key, err: (err as Error).message }, '[cron-lock] release threw')
  }
}
