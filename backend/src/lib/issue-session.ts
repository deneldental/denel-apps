/**
 * Issue a Better Auth session from our own route code.
 *
 * Replaces `issueStaffSession()` from the hand-rolled staff stack. The flows
 * that need this (staff phone+OTP login, kiosk operator hand-off) authenticate
 * the person through rules Better Auth does not know — an active-staff gate, no
 * SMS to unknown numbers, trusted devices — and only then need a session. They
 * keep owning those rules; Better Auth owns the session.
 *
 * Kept in its own module rather than in `lib/account-sessions.ts` because it
 * needs `getAuth`, and `src/auth.ts` imports `account-sessions` — putting it
 * there would close an import cycle.
 */

import type { Context } from 'hono'
import { getAuth } from '../auth'
import { resolveAppScope } from '../rbac/middleware/detectInterface'
import { recordAuthEvent } from './auth-events'
import { clientIp } from './rate-limiter'
import type { HonoEnv } from './types'

/**
 * Create a session for `userId` and set the cookie on this response.
 *
 * The session is created inside the Better Auth kernel (see
 * `lib/auth-plugins/server-session.ts`), so the cookie carries the right prefix
 * for the calling app, is signed, and the ban check applies. `returnHeaders`
 * hands back the `Set-Cookie` the kernel produced; we forward it verbatim
 * rather than rebuilding it, so cookie policy stays in one place.
 *
 * Throws if the user is missing or banned — callers should let that surface
 * rather than falling back to issuing a session another way.
 */
export async function issueUserSession(c: Context<HonoEnv>, userId: string): Promise<void> {
  const auth = getAuth(c)
  const { headers } = await auth.api.createServerSession({
    body: { userId },
    returnHeaders: true,
  })

  // `getSetCookie()` keeps multiple cookies separate; a plain `get()` would
  // join them with commas and corrupt any cookie containing one.
  const cookies = headers.getSetCookie?.() ?? []
  for (const cookie of cookies) {
    c.header('Set-Cookie', cookie, { append: true })
  }

  // M2: every session this system mints now leaves a record, whichever flow
  // asked for it — staff phone+OTP, trusted device, or the kiosk hand-off.
  recordAuthEvent({
    event: 'session_issue',
    outcome: 'success',
    userId,
    appScope: resolveAppScope(c),
    ipAddress: clientIp(c),
    userAgent: c.req.header('User-Agent') ?? null,
  })
}
