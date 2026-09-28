// API key helpers: hashing, generation, verification.
//
// Hash format: SHA-256 hex. Not a slow hash (bcrypt/argon2) because:
//   1. The plaintext is high-entropy (32 random bytes), so brute-forcing the
//      hash is computationally infeasible regardless of the hash function.
//   2. Per-request verification needs to be cheap; the public endpoint that
//      checks this runs on every website-booking submission.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import type { Context, MiddlewareHandler, Next } from 'hono'
import { getDb } from '../db'
import { apiKeys } from '../db/schema'
import { logError } from './logger'
import type { HonoEnv } from './types'

const KEY_BYTES = 32
const PREFIX_LEN = 8
/** Header the website sends to authenticate. */
export const API_KEY_HEADER = 'x-api-key'

export type ApiKeyScope = 'website_bookings.create'

/** Returns { plaintext, prefix, hash } — store the hash, show the plaintext once. */
export function generateApiKey(): { plaintext: string; prefix: string; hash: string } {
  const plaintext = `fmk_${randomBytes(KEY_BYTES).toString('base64url')}`
  const prefix = plaintext.slice(0, PREFIX_LEN)
  const hash = sha256(plaintext)
  return { plaintext, prefix, hash }
}

export function sha256(plain: string): string {
  return createHash('sha256').update(plain, 'utf8').digest('hex')
}

/**
 * Constant-time compare two hex digests of equal length. Guards against
 * timing attacks on the lookup path (the unique index already makes that
 * mostly moot, but cheap insurance).
 */
export function hashesEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}

export type VerifiedApiKey = {
  id: string
  label: string
  scope: string
  createdById: string
  createdAt: Date
  lastUsedAt: Date | null
}

/**
 * Verifies a plaintext key against the DB. Returns the key row if it exists,
 * is not revoked, and matches the requested scope. Side-effect: stamps
 * `lastUsedAt` on a successful match.
 */
export async function verifyApiKey(
  plaintext: string,
  requiredScope: ApiKeyScope
): Promise<VerifiedApiKey | null> {
  if (!plaintext || plaintext.length < 16) return null
  const hash = sha256(plaintext)
  const db = getDb(process.env.DATABASE_URL!)

  const [row] = await db
    .select()
    .from(apiKeys)
    .where(
      and(eq(apiKeys.keyHash, hash), eq(apiKeys.scope, requiredScope), isNull(apiKeys.revokedAt))
    )
    .limit(1)

  if (!row) return null
  if (!hashesEqual(row.keyHash, hash)) return null

  // Fire-and-forget — bookkeeping shouldn't slow down or fail the request.
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id))
    .catch((err) => logError(err, { route: 'api-keys.touch-lastUsed', keyId: row.id }))

  return {
    id: row.id,
    label: row.label,
    scope: row.scope,
    createdById: row.createdById,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  }
}

/**
 * Hono middleware that requires a valid API key for a given scope. Pairs
 * well with `rateLimitMiddleware` on the same route — defence in depth.
 */
export function requireApiKey(scope: ApiKeyScope): MiddlewareHandler<HonoEnv> {
  return async (c: Context<HonoEnv>, next: Next) => {
    const headerKey = c.req.header(API_KEY_HEADER) ?? c.req.header('X-Api-Key')
    if (!headerKey) {
      return c.json({ error: 'Missing API key', code: 'API_KEY_REQUIRED' }, 401, {
        'WWW-Authenticate': `ApiKey scope="${scope}"`,
      })
    }
    const verified = await verifyApiKey(headerKey, scope)
    if (!verified) {
      return c.json({ error: 'Invalid API key', code: 'API_KEY_INVALID' }, 401)
    }
    c.set('apiKey', verified)
    return next()
  }
}
