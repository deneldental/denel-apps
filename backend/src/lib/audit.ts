import type { MiddlewareHandler } from 'hono'
import { env } from '../config/env'
import { type DB, getDb } from '../db'
import { auditLogs } from '../db/schema'
import { logError } from './logger'
import { getCurrentUser } from './rbac'
import type { HonoEnv } from './types'

export interface AuditLogData {
  userId: string
  action: string
  module: string
  entityId?: string | null
  entityName?: string | null
  changes?: Record<string, any> | null
  // Phase H3.2 â€” precise before/after diff (for critical tables)
  beforeJson?: Record<string, any> | null
  afterJson?: Record<string, any> | null
  changedFields?: string[] | null
  reason?: string | null
  ipAddress?: string | null
  userAgent?: string | null
}

/**
 * Field names whose VALUE must never reach `audit_logs`, matched
 * case-insensitively against the key.
 *
 * This is separate from DIFF_IGNORE_FIELDS below, which drops noisy or
 * uninteresting columns from a diff. This set is about secrets: a credential
 * written here is a credential at rest in a table `/api/audit-logs` serves to
 * anyone holding the audit-logs read permission, and it survives every later
 * password rotation.
 *
 * It was not hypothetical. `routes/users.ts` passed the raw request body as
 * `changes` on both user-create and admin-password-set, so the CLEARTEXT
 * password of every account provisioned through the portal was persisted here
 * — the same defect class as C1 ("plaintext passwords written to logs"), in a
 * sink the C1 fix never looked at.
 *
 * Redacted to a marker rather than deleted, so the audit trail still records
 * that a password WAS set — which is the part that matters for review.
 */
const SECRET_FIELD_PATTERN = /pass(word|phrase)|secret|token|apikey|api_key|credential|otp|pin\b/i
const REDACTED = '[redacted]'

/**
 * Replace the value of any secret-named key with a marker. Recurses into
 * nested objects and arrays, because a body like `{ user: { password } }`
 * leaks exactly as well as a flat one.
 */
export function redactSecrets<T>(value: T, depth = 0): T {
  if (depth > 6 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1)) as unknown as T

  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_FIELD_PATTERN.test(k) ? REDACTED : redactSecrets(v, depth + 1)
  }
  return out as unknown as T
}

/**
 * Creates an audit log entry in the database.
 *
 * @param db - The Drizzle database instance
 * @param data - The audit log data to insert
 */
export async function createAuditLog(db: DB, data: AuditLogData) {
  try {
    const [newLog] = await db
      .insert(auditLogs)
      .values({
        userId: data.userId,
        action: data.action,
        module: data.module,
        entityId: data.entityId || null,
        entityName: data.entityName || null,
        // Redacted HERE, at the single write point, rather than at each of the
        // ~19 call sites that pass a raw request body as `changes`. A call site
        // that forgets is invisible until someone reads the table.
        changes: data.changes ? redactSecrets(data.changes) : null,
        beforeJson: data.beforeJson ? redactSecrets(data.beforeJson) : null,
        afterJson: data.afterJson ? redactSecrets(data.afterJson) : null,
        changedFields: data.changedFields || null,
        reason: data.reason || null,
        ipAddress: data.ipAddress || null,
        userAgent: data.userAgent || null,
      })
      .returning()

    return newLog
  } catch (error) {
    logError(error, { context: 'Failed to create audit log' })
    return null
  }
}

// â”€â”€ H3.2 â€” JSON diff helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Fields that should never be included in audit diffs (noise, PII hashes, etc.)
 */
const DIFF_IGNORE_FIELDS = new Set([
  'updatedAt',
  'createdAt',
  'pwaPasswordHash',
  'signatureData',
  'witnessSignatureData',
  'accessCode',
  'linkToken',
  'tokenHash',
  'confirmationToken',
])

/**
 * Compute the list of fields that changed between two objects.
 * Compares by value; ignores timestamp columns and sensitive fields.
 */
export function computeChangedFields(
  before: Record<string, any> | null,
  after: Record<string, any> | null
): string[] {
  if (!before || !after) return []
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const changed: string[] = []
  for (const k of keys) {
    if (DIFF_IGNORE_FIELDS.has(k)) continue
    const a = before[k]
    const b = after[k]
    // Deep-ish compare via JSON.stringify â€” good enough for audit purposes
    if (JSON.stringify(normalize(a)) !== JSON.stringify(normalize(b))) {
      changed.push(k)
    }
  }
  return changed.sort()
}

function normalize(v: any): any {
  if (v instanceof Date) return v.toISOString()
  if (v === undefined) return null
  return v
}

/**
 * Strip sensitive fields from a row snapshot before storing.
 * Ensures we never write hashes / tokens / signatures to the audit log.
 */
export function redactForAudit<T extends Record<string, any>>(row: T | null): T | null {
  if (!row) return null
  const out = { ...row } as Record<string, any>
  for (const k of DIFF_IGNORE_FIELDS) {
    if (k === 'updatedAt' || k === 'createdAt') continue // keep timestamps
    if (k in out) delete out[k]
  }
  return out as T
}

/**
 * Record an audit entry with precise before/after JSON diffs for a critical mutation.
 *
 * Usage:
 *   const before = await db.select().from(patients).where(eq(patients.id, id)).limit(1);
 *   // ... perform update ...
 *   const after  = await db.select().from(patients).where(eq(patients.id, id)).limit(1);
 *   await recordDiffAudit(db, {
 *     userId: user.id,
 *     action: 'update',
 *     module: 'patients',
 *     entityId: id,
 *     entityName: after[0]?.name ?? 'Patient',
 *     before: before[0] ?? null,
 *     after: after[0] ?? null,
 *     reason: body.reason,
 *   });
 *
 * Skips the insert entirely if nothing meaningful changed on an update.
 */
export async function recordDiffAudit(
  db: any,
  params: {
    userId: string
    action: 'create' | 'update' | 'delete'
    module: string
    entityId?: string | null
    entityName?: string | null
    before: Record<string, any> | null
    after: Record<string, any> | null
    reason?: string | null
    ipAddress?: string | null
    userAgent?: string | null
  }
) {
  const beforeJson = redactForAudit(params.before)
  const afterJson = redactForAudit(params.after)
  const changedFields =
    params.action === 'update' ? computeChangedFields(beforeJson, afterJson) : []

  // For updates, skip no-op audits (nothing actually changed)
  if (params.action === 'update' && changedFields.length === 0) return null

  return createAuditLog(db, {
    userId: params.userId,
    action: params.action,
    module: params.module,
    entityId: params.entityId ?? null,
    entityName: params.entityName ?? null,
    beforeJson,
    afterJson,
    changedFields: changedFields.length > 0 ? changedFields : null,
    reason: params.reason ?? null,
    ipAddress: params.ipAddress ?? null,
    userAgent: params.userAgent ?? null,
  })
}

/**
 * Middleware to automatically log mutations (POST, PUT, PATCH, DELETE)
 */
export const auditMiddleware = (): MiddlewareHandler<HonoEnv> => {
  // Changed type parameter to HonoEnv
  return async (c, next) => {
    const method = c.req.method
    const path = c.req.path

    // Only log mutations
    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)

    // Skip paths that are clearly not needed or would be redundant
    const isExcluded =
      path.startsWith('/api/audit-logs') ||
      path.startsWith('/api/health') ||
      path.startsWith('/api/auth/session') || // Fetched frequently
      path.startsWith('/api/lookups')

    await next()

    const skipAudit = c.get('skipAudit') // Removed 'as any'

    if (isMutation && !isExcluded && c.res.status < 400 && !skipAudit) {
      try {
        const user = await getCurrentUser(c)
        if (user) {
          const db = getDb(env.DATABASE_URL)

          // Simple logic to derive module and action from path and method
          const pathParts = path.split('/').filter((p) => p && p !== 'api')
          const module = pathParts[0] || 'general'

          let action = method.toLowerCase()
          if (method === 'POST') action = 'create'
          if (method === 'PUT' || method === 'PATCH') action = 'update'
          if (method === 'DELETE') action = 'delete'

          // Additional context
          const ipAddress = c.req.header('x-forwarded-for') || c.req.header('cf-connecting-ip')
          const userAgent = c.req.header('user-agent')

          // If it's a POST to /api/auth/login etc, we might handle it differently but Better Auth is complex.
          // For now, let's keep it simple.

          await createAuditLog(db, {
            userId: user.id,
            action,
            module,
            ipAddress,
            userAgent,
            // entityId and entityName will be empty for automated logs unless manually instrumented
          })
        }
      } catch (err) {
        logError(err, { context: '[auditMiddleware] failed to log' })
      }
    }
  }
}
