/**
 * Staff Auth — passwordless phone + SMS-OTP for the staff PWA.
 *
 * New flow (mirrors patient-auth.ts, one phone = one staff, no profile picker):
 *   POST /login       { phone }        → lookup active staff; trusted device →
 *                                        { requiresOtp:false }, else send OTP.
 *   POST /verify-otp  { phone, code }  → verify, trust device, issue session.
 *   POST /session     { phone }        → trusted-device path: issue session.
 *   GET  /me                           → current staff (custom session cookie).
 *   POST /logout                       → clear the staff session (keep trust).
 *   POST /forget-this-device           → revoke this device's trust.
 *
 * Sessions are BETTER AUTH sessions (stage 2 of the auth consolidation). This
 * route still owns the rules Better Auth does not know — active-staff lookup by
 * phone, no SMS to unknown numbers, trusted devices, and the `pwa` interface
 * scope — and then calls `issueUserSession`, which creates the session inside
 * the Better Auth kernel. `staff_sessions` is no longer written by any flow;
 * `getCurrentUser` stays dual-source only to honour rows issued before the
 * switch. See project-docs/auth-consolidation-plan.md.
 */

import { and, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { getAuth } from '../auth'
import { env, isDevEnvironment } from '../config/env'
import { getDb } from '../db'
import { staff, user } from '../db/schema'
import { recordAuthEvent } from '../lib/auth-events'
import { issueUserSession } from '../lib/issue-session'
import { logError } from '../lib/logger'
import { clientIp } from '../lib/rate-limiter'
import { getCurrentUser } from '../lib/rbac'
import { requestStaffOtp, verifyStaffOtp } from '../lib/staff-otp'
import { clearStaffSession } from '../lib/staff-session'
import {
  clearCurrentStaffDeviceTrust,
  isTrustedStaffDevice,
  trustStaffDevice,
} from '../lib/staff-trusted-device'
import type { HonoEnv } from '../lib/types'
import { formatPhoneNumber, isValidPhoneNumber } from '../lib/utils/phone'
import { PermissionEngine } from '../rbac/engine/PermissionEngine'

const staffAuthApp = new Hono<HonoEnv>()

// ─── IP rate limiter ─────────────────────────────────────────────────────────
// 30 requests / 5 min / IP across /api/staff-auth/* — brute-force + SMS-bomb
// defense on top of the per-phone OTP cap. Skipped in dev.
const _ipStore = new Map<string, { count: number; resetAt: number }>()
const IP_LIMIT = 30
const IP_WINDOW_MS = 5 * 60 * 1000
const IP_STORE_MAX = 5000

staffAuthApp.use('*', async (c, next) => {
  if (isDevEnvironment()) return next()
  const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? ''
  if (!ip) return next()
  const now = Date.now()
  const entry = _ipStore.get(ip)
  if (!entry || now > entry.resetAt) {
    if (!entry && _ipStore.size >= IP_STORE_MAX) {
      for (const [k, v] of _ipStore) {
        if (now > v.resetAt) {
          _ipStore.delete(k)
          break
        }
      }
    }
    _ipStore.set(ip, { count: 1, resetAt: now + IP_WINDOW_MS })
  } else {
    entry.count++
    if (entry.count > IP_LIMIT) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
      return c.json({ error: 'Too many requests. Please try again later.' }, 429, {
        'Retry-After': String(retryAfter),
      })
    }
  }
  return next()
})

type StaffRow = typeof staff.$inferSelect
type UserRow = typeof user.$inferSelect

// Resolve the active, non-deleted staff member (with a linked auth user) whose
// phone normalizes to `normalizedPhone`. Phone is intended to be 1:1 with staff.
// Exactly one match resolves; zero or MORE THAN ONE resolves to null.
//
// Ambiguity is refused rather than tie-broken. Until the uniqueness constraint
// lands (Phase 4) a duplicate number used to resolve silently to the oldest row
// — which in practice was an account with no `pwa` interface scope, so the user
// got an unexplainable "no access" wall instead of a diagnosable failure. The
// caller now sees the same generic answer as an unknown number (no enumeration,
// no hint about who collided); the colliding staff IDs go to the server log.
async function findActiveStaffByPhone(
  db: ReturnType<typeof getDb>,
  normalizedPhone: string
): Promise<{ staff: StaffRow; user: UserRow } | null> {
  const rows = await db
    .select({ staff, user })
    .from(staff)
    .innerJoin(user, eq(user.id, staff.userId))
    .where(and(eq(staff.status, 'active'), isNull(staff.deletedAt)))
    .orderBy(staff.createdAt)
  const matches = rows.filter((r) => formatPhoneNumber(r.staff.phone) === normalizedPhone)
  if (matches.length > 1) {
    logError(new Error('Ambiguous staff phone — sign-in refused'), {
      scope: 'staff-auth',
      phoneSuffix: normalizedPhone.slice(-4),
      staffIds: matches.map((m) => m.staff.staffId),
    })
    return null
  }
  return matches[0] ?? null
}

// Shape returned to the staff PWA on login + /me. Auth identity from `user`
// (drives RBAC routing via roleId/role); display bits from the staff record.
function staffSelfPayload(u: UserRow, s: StaffRow) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    image: u.image ?? s.profileImage ?? null,
    role: u.role ?? null,
    roleId: u.roleId ?? null,
    phone: u.phone ?? s.phone ?? null,
    staffId: s.staffId,
    fullName: s.fullName,
    position: s.position,
    isBreakfastLead: s.isBreakfastLead,
  }
}

/**
 * May this user actually use the Team app? Authentication proves who they are;
 * this is the authorization half.
 *
 * Without it, proving the OTP minted a session for anyone with an active staff
 * row — including roles with no `pwa` scope (an `admin` holds only
 * portal + hr). The session was issued, and then the global
 * `enforceInterfaceScope` guard answered 403 to every subsequent call: a
 * credential that exists but opens nothing. Refusing here means no session is
 * created at all, which is both the correct authorization boundary and the
 * honest answer to the client.
 *
 * Checked at session issuance rather than at /login so a failure cannot be used
 * to probe which phone numbers hold which scopes before an OTP is proven.
 */
async function hasTeamAppAccess(userId: string): Promise<boolean> {
  const engine = new PermissionEngine(getDb(env.DATABASE_URL))
  return engine.checkScope(userId, 'pwa')
}

const NO_TEAM_ACCESS = 'Your account does not have access to the Team app.'

// ── POST /login — phone entry ────────────────────────────────────────────────
staffAuthApp.post('/login', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { phone?: string } | null
  const rawPhone = body?.phone
  if (!rawPhone || typeof rawPhone !== 'string') {
    return c.json({ error: 'Phone number is required' }, 400)
  }
  const phone = formatPhoneNumber(rawPhone)
  if (!isValidPhoneNumber(phone)) {
    return c.json({ error: 'Enter a valid phone number' }, 400)
  }

  const db = getDb(env.DATABASE_URL)
  const found = await findActiveStaffByPhone(db, phone)
  // Gate: unknown / inactive phone → generic message, NO SMS (no enumeration).
  if (!found) {
    return c.json({
      success: false,
      enabled: false,
      error: "This phone number isn't set up for staff sign-in. Please contact your administrator.",
    })
  }

  // Trusted device → skip OTP.
  if (await isTrustedStaffDevice(db, found.staff.id, c)) {
    return c.json({ success: true, requiresOtp: false })
  }

  const result = await requestStaffOtp(db, found.staff.id, 'login_phone', phone)
  recordAuthEvent({
    event: 'otp_issue',
    outcome: result.ok ? 'success' : 'blocked',
    userId: found.user.id,
    identifier: phone,
    reason: result.ok ? null : 'throttled',
    appScope: 'pwa',
    ipAddress: clientIp(c),
    userAgent: c.req.header('User-Agent') ?? null,
  })
  if (!result.ok) return c.json({ error: result.error ?? 'Could not send code' }, 429)
  return c.json({ success: true, requiresOtp: true, phoneHint: phone.slice(-4) })
})

// ── POST /verify-otp — code entry → trust device + issue session ─────────────
staffAuthApp.post('/verify-otp', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { phone?: string; code?: string } | null
  const rawPhone = body?.phone
  const code = body?.code?.trim()
  if (!rawPhone || !code) return c.json({ error: 'Phone and code are required' }, 400)
  const phone = formatPhoneNumber(rawPhone)

  const db = getDb(env.DATABASE_URL)
  const found = await findActiveStaffByPhone(db, phone)
  if (!found) return c.json({ error: 'This phone number is not recognised.' }, 401)

  const verify = await verifyStaffOtp(db, found.staff.id, 'login_phone', code)
  if (!verify.ok) {
    recordAuthEvent({
      event: 'otp_verify',
      outcome: 'failure',
      userId: found.user.id,
      identifier: phone,
      // `verify.reason` distinguishes no_code / wrong_code / attempts_exhausted
      // for the log only — the response body stays uniform (M1).
      reason: verify.reason ?? 'invalid',
      appScope: 'pwa',
      ipAddress: clientIp(c),
      userAgent: c.req.header('User-Agent') ?? null,
    })
    return c.json({ error: verify.error ?? 'Invalid or expired code' }, 400)
  }

  if (!(await hasTeamAppAccess(found.user.id))) {
    recordAuthEvent({
      event: 'scope_denied',
      outcome: 'blocked',
      userId: found.user.id,
      identifier: phone,
      reason: 'missing_pwa_scope',
      appScope: 'pwa',
      ipAddress: clientIp(c),
      userAgent: c.req.header('User-Agent') ?? null,
    })
    return c.json({ error: NO_TEAM_ACCESS }, 403)
  }

  recordAuthEvent({
    event: 'otp_verify',
    outcome: 'success',
    userId: found.user.id,
    identifier: phone,
    appScope: 'pwa',
    ipAddress: clientIp(c),
    userAgent: c.req.header('User-Agent') ?? null,
  })

  await trustStaffDevice(db, found.staff.id, c)
  await issueUserSession(c, found.user.id)
  return c.json({ success: true, staff: staffSelfPayload(found.user, found.staff) })
})

// ── POST /session — trusted-device login (no OTP) ────────────────────────────
staffAuthApp.post('/session', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { phone?: string } | null
  const rawPhone = body?.phone
  if (!rawPhone) return c.json({ error: 'Phone number is required' }, 400)
  const phone = formatPhoneNumber(rawPhone)

  const db = getDb(env.DATABASE_URL)
  const found = await findActiveStaffByPhone(db, phone)
  if (!found) return c.json({ error: 'This phone number is not recognised.' }, 401)
  if (!(await isTrustedStaffDevice(db, found.staff.id, c))) {
    return c.json({ error: 'This device needs to verify with a code first.' }, 401)
  }
  // A device trusted before the user's scope was revoked must not keep minting
  // sessions — trust is about the device, not about current authorization.
  if (!(await hasTeamAppAccess(found.user.id))) return c.json({ error: NO_TEAM_ACCESS }, 403)

  await issueUserSession(c, found.user.id)
  return c.json({ success: true, staff: staffSelfPayload(found.user, found.staff) })
})

// ── GET /me — session probe ──────────────────────────────────────────────────
staffAuthApp.get('/me', async (c) => {
  // Resolves Better Auth sessions AND any legacy `staff_session` still in the
  // wild, via getCurrentUser's dual-source read. Reading getSessionStaff
  // directly would have 401'd every session issued after the switch.
  const sessionUser = await getCurrentUser(c)
  if (!sessionUser) return c.json({ error: 'Not authenticated' }, 401)
  const db = getDb(env.DATABASE_URL)
  const [staffRecord] = await db
    .select()
    .from(staff)
    .where(
      and(eq(staff.userId, sessionUser.id), eq(staff.status, 'active'), isNull(staff.deletedAt))
    )
    .limit(1)
  // staffSelfPayload needs the full user row; getCurrentUser returns the slim
  // AuthUser shape shared by both session mechanisms.
  const [userRow] = await db.select().from(user).where(eq(user.id, sessionUser.id)).limit(1)
  if (!userRow) return c.json({ error: 'Not authenticated' }, 401)
  // An offboarded / inactive / deleted staff must not keep a live session:
  // treat them as signed-out (401) so the Team shell drops them at the next
  // /me probe, rather than trusting the cookie until it expires. This mirrors
  // findActiveStaffByPhone's gate on the login path.
  if (!staffRecord) return c.json({ error: 'Session no longer valid' }, 401)
  return c.json({ success: true, staff: staffSelfPayload(userRow, staffRecord) })
})

// ── POST /logout — clear the staff session (device trust kept) ───────────────
staffAuthApp.post('/logout', async (c) => {
  // Clear both: the Better Auth session this now issues, and any legacy
  // `staff_session` cookie from before the switch. Clearing only one would
  // leave the caller signed in via the other.
  const sessionUser = await getCurrentUser(c)
  if (sessionUser) {
    await getAuth(c)
      .api.signOut({ headers: c.req.raw.headers, returnHeaders: true })
      .then(({ headers }) => {
        for (const cookie of headers.getSetCookie?.() ?? []) {
          c.header('Set-Cookie', cookie, { append: true })
        }
      })
      .catch(() => {})
  }
  await clearStaffSession(c)
  return c.json({ success: true })
})

// ── POST /forget-this-device — un-trust this device (re-OTP next sign-in) ─────
staffAuthApp.post('/forget-this-device', async (c) => {
  const sessionUser = await getCurrentUser(c)
  if (!sessionUser) return c.json({ error: 'Not authenticated' }, 401)
  const db = getDb(env.DATABASE_URL)
  await clearCurrentStaffDeviceTrust(db, c)
  return c.json({ success: true })
})

export { staffAuthApp }
