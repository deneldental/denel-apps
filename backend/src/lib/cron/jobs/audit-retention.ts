/**
 * Monthly audit-log + login-attempt retention.
 *
 * - audit_logs:    kept for the period chosen in Settings → Security & Kiosk
 *                  (`security:audit_retention`: 90 / 180 / 365 days, or
 *                  "indefinite" = never purged). Unset → 365 days.
 * - login_attempts: keep 30 days. Rate-limit data has no lasting value
 *                   beyond a short investigation window.
 *
 * Both deletes are non-cascading and idempotent.
 */

import { lt } from 'drizzle-orm'
import { env } from '../../../config/env'
import { getDb } from '../../../db'
import { auditLogs, loginAttempts } from '../../../db/schema/operations'
import { getAuditRetentionDays } from '../../settings-store'
import type { JobContext, JobRunResult } from '../types'

const LOGIN_ATTEMPT_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

export async function runAuditRetention(_ctx: JobContext): Promise<JobRunResult> {
  const db = getDb(env.DATABASE_URL)
  const auditRetentionDays = await getAuditRetentionDays(db)

  const auditDeleted =
    auditRetentionDays === null
      ? []
      : await db
          .delete(auditLogs)
          .where(lt(auditLogs.createdAt, new Date(Date.now() - auditRetentionDays * DAY_MS)))
          .returning({ id: auditLogs.id })

  const loginDeleted = await db
    .delete(loginAttempts)
    .where(lt(loginAttempts.attemptedAt, new Date(Date.now() - LOGIN_ATTEMPT_DAYS * DAY_MS)))
    .returning({ id: loginAttempts.id })

  const auditPart =
    auditRetentionDays === null
      ? 'audit_logs:kept (indefinite)'
      : `audit_logs:${auditDeleted.length}`
  return {
    summary: `deleted ${auditPart} login_attempts:${loginDeleted.length}`,
    details: {
      auditLogsDeleted: auditDeleted.length,
      auditLogRetentionDays: auditRetentionDays,
      loginAttemptsDeleted: loginDeleted.length,
      loginAttemptRetentionDays: LOGIN_ATTEMPT_DAYS,
    },
  }
}
