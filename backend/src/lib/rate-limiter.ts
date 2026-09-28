/**
 * Minimal in-memory rate limiter factory.
 *
 * Each call to `createRateLimiter` returns an independent store.
 * Use as Hono middleware via `rateLimitMiddleware`.
 *
 * Trade-offs:
 * - In-memory: cleared on restart, not shared across instances.
 * - Acceptable for the single-process Hetzner deployment.
 * - If horizontal scaling is introduced, swap the Map for Redis.
 *
 * Client identity comes from ONE header, set by the trusted proxy — see
 * `clientIp`. Never add a fallback chain here: a limiter that reads a header
 * the client can set is not a limiter.
 */

import type { Context, MiddlewareHandler, Next } from 'hono'
import { isDevEnvironment } from '../config/env'
import { logWarn } from './logger'

interface Bucket {
  count: number
  resetAt: number
}

interface RateLimiter {
  check(key: string): { allowed: boolean; retryAfterSec: number }
}

export function createRateLimiter(opts: {
  max: number
  windowMs: number
  maxKeys?: number
}): RateLimiter {
  const { max, windowMs, maxKeys = 10_000 } = opts
  const store = new Map<string, Bucket>()

  return {
    check(key: string) {
      const now = Date.now()
      const bucket = store.get(key)

      if (!bucket || now >= bucket.resetAt) {
        // Bounded insert. The previous version deleted at most one *expired*
        // entry per insert and inserted regardless, so a flood of distinct keys
        // grew the map without limit. Sweep expired entries first, then evict
        // oldest-first until there is room — the size cap now actually holds.
        if (!bucket && store.size >= maxKeys) {
          for (const [k, v] of store) {
            if (now >= v.resetAt) store.delete(k)
          }
          while (store.size >= maxKeys) {
            const oldest = store.keys().next().value
            if (oldest === undefined) break
            store.delete(oldest)
          }
        }
        store.set(key, { count: 1, resetAt: now + windowMs })
        return { allowed: true, retryAfterSec: 0 }
      }

      bucket.count++
      if (bucket.count > max) {
        return {
          allowed: false,
          retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000),
        }
      }
      return { allowed: true, retryAfterSec: 0 }
    },
  }
}

/**
 * Returns a Hono middleware that rate-limits by a derived key.
 * Skipped entirely in development.
 * `keyFn` should return null to bypass limiting for a specific request.
 */
export function rateLimitMiddleware(opts: {
  limiter: RateLimiter
  keyFn: (c: Context) => string | null
}): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    if (isDevEnvironment()) return next()

    const key = opts.keyFn(c)
    if (!key) return next()

    const result = opts.limiter.check(key)
    if (!result.allowed) {
      return c.json({ error: 'Too many requests. Please try again later.' }, 429, {
        'Retry-After': String(result.retryAfterSec),
      })
    }

    return next()
  }
}

/**
 * The single header the deployment's trusted proxy sets. Behind Cloudflare
 * Tunnel that is `cf-connecting-ip`, which the edge overwrites on every
 * request. Override only if the proxy in front changes.
 */
const TRUSTED_IP_HEADER = (process.env.TRUSTED_IP_HEADER ?? 'cf-connecting-ip').toLowerCase()

/** Loopback peers cannot be reached from off-box, so their address is trustworthy. */
function loopbackPeer(c: Context): string | null {
  const peer = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)
    ?.incoming?.socket?.remoteAddress
  if (!peer) return null
  const bare = peer.startsWith('::ffff:') ? peer.slice(7) : peer
  return bare === '127.0.0.1' || bare === '::1' ? bare : null
}

/**
 * The calling client's address, or null when it cannot be established.
 *
 * Reads exactly one header — the one the trusted proxy sets — and never falls
 * back to another. The previous implementation read `CF-Connecting-IP` then
 * `X-Forwarded-For`, both of which a direct caller can forge: rotating either
 * one handed out a fresh bucket per request and defeated every limit built on
 * it.
 *
 * Returns null rather than a placeholder. Callers MUST fail closed on null;
 * bucketing unidentified callers under a shared key (the old `?? 'unknown'`)
 * turns the limiter into a denial-of-service vector, because one caller can
 * exhaust the shared bucket for everyone.
 *
 * The loopback exception keeps local development working: a request whose peer
 * is 127.0.0.1 came from this machine, which no remote attacker can forge.
 * Behind the tunnel the peer is the cloudflared container, never loopback, so
 * this never applies in production.
 */
/**
 * Whether a request whose client address cannot be established is allowed
 * through. `TRUSTED_IP_MODE`:
 *
 *   enforce — reject it (default, and correct once a trusted proxy is in front)
 *   dryrun  — log and allow, for the window between deploying this and
 *             cutting over to the tunnel
 *   off     — allow silently
 *
 * DEPLOYMENT ORDER MATTERS: with no trusted proxy in front, every public
 * request lacks the header, so `enforce` would reject them all. Stand the
 * tunnel up first, confirm `cf-connecting-ip` is arriving, then deploy this.
 * If this ships first, set TRUSTED_IP_MODE=dryrun until the tunnel is live.
 */
type TrustedIpMode = 'off' | 'dryrun' | 'enforce'

function trustedIpMode(): TrustedIpMode {
  const v = (process.env.TRUSTED_IP_MODE ?? 'enforce').toLowerCase()
  return v === 'off' || v === 'dryrun' ? v : 'enforce'
}

export type ClientIpResult = { ok: true; ip: string } | { ok: false }

/**
 * Resolve the client address for rate-limiting, or refuse the request.
 *
 * Callers must not substitute a placeholder for a missing address: a shared
 * bucket lets one caller exhaust the limit for everyone.
 */
export function requireClientIp(c: Context): ClientIpResult {
  const ip = clientIp(c)
  if (ip) return { ok: true, ip }

  const mode = trustedIpMode()
  if (mode === 'enforce') return { ok: false }

  if (mode === 'dryrun') {
    logWarn('[trusted-ip] no client address; would reject (dry-run)', {
      path: c.req.path,
      method: c.req.method,
      header: TRUSTED_IP_HEADER,
    })
  }
  // Per-request key so an unidentified caller cannot exhaust a shared bucket
  // even while the check is soft.
  return { ok: true, ip: `unidentified:${crypto.randomUUID()}` }
}

export function clientIp(c: Context): string | null {
  const header = c.req.header(TRUSTED_IP_HEADER)
  if (header) {
    // Tolerate a comma-separated chain if TRUSTED_IP_HEADER is pointed at an
    // X-Forwarded-For style header: the proxy appends, so the first entry is
    // the client as the trusted hop saw it.
    const first = header.split(',')[0]?.trim()
    if (first) return first
  }
  return loopbackPeer(c)
}
