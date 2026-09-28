/**
 * The authentication trail (audit finding M2).
 *
 * Nothing in the auth path wrote to `audit_logs`: no sign-in success or
 * failure, no sign-out, no OTP issue or verify, no password reset, no ban, no
 * session creation. The consequence was concrete — when the post-remediation
 * audit found that an unauthenticated caller could revoke anyone's sessions
 * through the ban hook, there was no way to tell whether it had ever been used.
 *
 * ─── Rules ─────────────────────────────────────────────────────────────────
 *  1. **Never throws.** A trail that can fail a login is worse than no trail:
 *     it converts an observability problem into an outage. Every write is
 *     wrapped and swallowed, with the failure itself logged.
 *  2. **Never blocks.** Callers use `recordAuthEvent`, which dispatches and
 *     returns immediately. Sign-in latency must not depend on this.
 *  3. **Never records secrets.** No passwords, no OTP codes, no reset tokens,
 *     no session tokens. Identifiers and outcomes only — enough to answer who
 *     tried what, from where, and how it ended.
 */

import { getDb } from '../db'
import { authEvents } from '../db/schema'
import { logError } from './logger'

export type AuthEventName =
  | 'sign_in'
  | 'sign_out'
  | 'otp_issue'
  | 'otp_verify'
  | 'password_reset_request'
  | 'password_reset_complete'
  | 'password_set_by_admin'
  | 'session_issue'
  | 'ban'
  | 'scope_denied'

export type AuthEventOutcome = 'success' | 'failure' | 'blocked'

export interface AuthEventInput {
  event: AuthEventName
  outcome: AuthEventOutcome
  userId?: string | null
  /** Email or phone as presented, normalised. Never a credential. */
  identifier?: string | null
  /** Machine-readable cause: bad_credentials, throttled, no_code, banned, … */
  reason?: string | null
  appScope?: string | null
  ipAddress?: string | null
  userAgent?: string | null
  /** Extra context. Must not contain secrets. */
  detail?: Record<string, unknown> | null
}

/**
 * Write one auth event. Awaitable, but callers normally use
 * {@link recordAuthEvent} so the request is never held up by it.
 */
export async function writeAuthEvent(input: AuthEventInput): Promise<void> {
  try {
    const db = getDb(process.env.DATABASE_URL as string)
    await db.insert(authEvents).values({
      event: input.event,
      outcome: input.outcome,
      userId: input.userId ?? null,
      identifier: input.identifier ? input.identifier.trim().toLowerCase().slice(0, 320) : null,
      reason: input.reason ?? null,
      appScope: input.appScope ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ? input.userAgent.slice(0, 500) : null,
      detail: input.detail ?? null,
    })
  } catch (err) {
    // Deliberately terminal. If the trail cannot be written we want to know,
    // but the caller's flow must continue regardless — see rule 1.
    logError(err, { context: '[auth-events] write failed', event: input.event })
  }
}

/** Fire-and-forget form. Use this from request paths. */
export function recordAuthEvent(input: AuthEventInput): void {
  void writeAuthEvent(input)
}
