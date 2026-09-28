// Shared helpers for soft-delete / archive flows.
//
// Two concerns live here:
//   1. Verifying the current user's admin password before a permanent
//      delete. The portal opens a small "type your password" modal and
//      forwards the value to the delete endpoint.
//   2. Telling user-initiated archives from migration archives. The
//      invoices.archived flag has been used since Phase 5 to hide
//      child-installment rows superseded by master invoices. Those rows
//      have `archivedBy = NULL` because no human did the archive — only
//      rows with `archivedBy IS NOT NULL` belong in the user-facing
//      Archived tab.
import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import type { getDb } from '../db'
import { account } from '../db/schema'
import { verifyPassword } from './password'
import { isAdmin } from './rbac'
import type { HonoEnv } from './types'

type DB = ReturnType<typeof getDb>

/**
 * Verify the supplied plaintext password matches the current user's
 * credential hash AND the current user has the admin role. Used to gate
 * permanent-delete actions in the Archived tab.
 *
 * Returns:
 *   - { ok: true } on success
 *   - { ok: false, reason: 'unauthorized' } if the caller is not admin
 *   - { ok: false, reason: 'invalid_password' } if password doesn't match
 *   - { ok: false, reason: 'no_credential' } if the user has no password
 *     credential on file (SSO-only)
 */
export async function verifyAdminPassword(
  c: Context<HonoEnv>,
  db: DB,
  userId: string,
  password: string
): Promise<
  { ok: true } | { ok: false; reason: 'unauthorized' | 'invalid_password' | 'no_credential' }
> {
  if (!(await isAdmin(c, userId))) return { ok: false, reason: 'unauthorized' }
  if (!password || typeof password !== 'string') return { ok: false, reason: 'invalid_password' }
  const [credential] = await db
    .select({ password: account.password })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
    .limit(1)
  if (!credential?.password) return { ok: false, reason: 'no_credential' }
  const valid = await verifyPassword({ hash: credential.password, password })
  if (!valid) return { ok: false, reason: 'invalid_password' }
  return { ok: true }
}
