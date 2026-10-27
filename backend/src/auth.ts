import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import { admin, username } from 'better-auth/plugins'
import type { Context } from 'hono'
import { isDevEnvironment } from './config/env'
import type { DB } from './db'
import { getDb, schema } from './db'
import { sendEmail } from './email'
import { revokeAllSessionsForUser } from './lib/account-sessions'
import { recordAuthEvent } from './lib/auth-events'
import { serverSession } from './lib/auth-plugins/server-session'
import { logError, logger } from './lib/logger'
import { hashPassword, verifyPassword } from './lib/password'
import { clearPasswordChange, requirePasswordChange } from './lib/password-change'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './lib/password-policy'
import { COOKIE_DOMAIN, sharesSiteWithBackend } from './lib/same-site'
import type { HonoEnv } from './lib/types'
import { deriveInterface } from './rbac/middleware/detectInterface'
import { invalidateSessionCacheForAuthPath } from './rbac/session-cache'

/**
 * The only per-caller inputs to the Better Auth kernel. Everything else in the
 * config is read from `process.env`, which is fixed for the life of the process
 * — so two requests with the same values here need the exact same instance, and
 * that instance can be memoised (see `getAuth`).
 *
 * Nothing request-specific may be added here: the instance outlives the request
 * that built it, and the session is always read from the headers handed to
 * `auth.api.*` / `auth.handler` per call.
 */
interface AuthBuildOptions {
  db: DB
  cookiePrefix: string
  isHttps: boolean
  isSameSiteWithFrontend: boolean
}

/**
 * Did the endpoint this `after` hook is running for actually fail?
 *
 * Better Auth runs after-hooks for EVERY request to a path, successful or not.
 * It sets `context.returned` to the handler's value on success and to the
 * thrown `APIError` on failure, then invokes the hooks either way
 * (`dist/api/to-auth-endpoints.mjs`: `context.returned = result.response`
 * immediately before `runAfterHooks`). So any after-hook with a side effect
 * MUST check this, or the side effect also happens on rejected calls.
 *
 * Mirrors better-auth's own `isAPIError`, including the `name` duck-check, so
 * it still holds if two copies of the error class end up loaded.
 */
function endpointFailed(ctx: { context: { returned?: unknown } }): boolean {
  const returned = ctx.context.returned as { name?: unknown } | null | undefined
  return returned?.name === 'APIError'
}

/**
 * The only `user` columns a signed-in user may change about themselves through
 * Better Auth's built-in `POST /api/auth/update-user`.
 *
 * That endpoint writes every field the schema marks as client input — which
 * includes our `roleId` (RBAC), `phone`, and the username plugin's
 * `username` / `displayUsername` (the staff-ID sign-in handle). With `roleId`
 * writable, any session could send `{"roleId":"admin"}` and become an admin:
 * `PermissionEngine` trusts the stored value. Verified end to end in
 * tests/integration/auth-update-user.test.ts (F15 in
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md).
 *
 * Roles, phones and staff IDs change through the Access Management, Users and
 * HR routes, which check `users:*` / `staff:*`. No client calls `update-user`.
 */
const SELF_EDITABLE_USER_FIELDS: ReadonlySet<string> = new Set(['name', 'image'])

/**
 * Builds the Better Auth kernel.
 *
 * Kept as its own function on purpose: TypeScript infers the concrete
 * `Auth<{...}>` type — including the `admin()` / `username()` plugin endpoints
 * such as `api.setUserPassword` — from the object literal below. Declaring the
 * memo as `Map<string, ReturnType<typeof betterAuth>>` instead would widen that
 * to `Auth<BetterAuthOptions>` and erase every plugin-inferred endpoint.
 */
function buildAuth({ db, cookiePrefix, isHttps, isSameSiteWithFrontend }: AuthBuildOptions) {
  return betterAuth({
    basePath: '/api/auth',
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema,
    }),
    user: {
      // Expose custom user table columns in the session response so the
      // frontend receives roleId (our custom RBAC FK) alongside the
      // better-auth 'role' field from the admin() plugin.
      //
      // `input: false` keeps them READABLE (still returned in the session) but
      // refuses them as client input. Without it `POST /api/auth/update-user`
      // let any session rewrite its own roleId — see SELF_EDITABLE_USER_FIELDS.
      additionalFields: {
        roleId: {
          type: 'string',
          required: false,
          fieldName: 'roleId',
          input: false,
        },
        phone: {
          type: 'string',
          required: false,
          fieldName: 'phone',
          input: false,
        },
        // F20 / D8 — readable in the session so the portal and HR app can send a
        // flagged user to the change-password screen; `input: false` so no client can
        // clear it with update-user (only changing the password does).
        mustChangePassword: {
          type: 'boolean',
          required: false,
          defaultValue: false,
          fieldName: 'mustChangePassword',
          input: false,
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      // No public account creation. Left at the default, Better Auth mounts
      // POST /api/auth/sign-up/email for anyone, and the catch-all in app.ts
      // passes it straight through. Staff accounts are provisioned by the
      // admin/HR flows, which attach a role; a self-registered user would hold
      // a valid session against a clinical API with no role at all.
      disableSignUp: true,
      // L9 — Better Auth enforces its own minimum on the paths it owns
      // (/reset-password, /change-password). Without this it used its default
      // while our routes required 8 or 10, so the effective policy depended on
      // which door the password came through. `lib/password-policy.ts` is the
      // source of truth; this keeps the kernel in step with it.
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      // Reset links expire after 1 hour. Without this, Better Auth's default
      // is much longer — leaked reset emails would remain valid for days.
      resetPasswordTokenExpiresIn: 60 * 60,
      // Better Auth deletes `session` rows on reset ONLY when this is set
      // (`dist/api/routes/password.mjs`: the delete is guarded by exactly this
      // flag). Left unset, the portal's own forgot-password flow completed
      // while every existing session stayed alive — which is H4 all over again
      // on the path the portal actually uses, and it LOOKED fixed because
      // `/reset-password` is in SESSION_MUTATING_AUTH_PATHS, so the session
      // cache cleared while the database rows survived.
      //
      // `onPasswordReset` below does the full revoke (this flag only covers
      // Better Auth's own table). Both are kept: the hook is the contract, the
      // flag is the kernel agreeing with it.
      revokeSessionsOnPasswordReset: true,
      // argon2id via @node-rs/argon2, at the OWASP 2024 profile — NOT
      // better-auth's default @noble/hashes/scrypt, which is pure JS and far
      // too slow to run on every sign-in.
      //
      // This comment said PBKDF2 for a long time. PBKDF2 was the intermediate
      // step and `verifyPassword` still reads those hashes, but nothing has
      // produced one since the argon2id migration. See src/lib/password.ts for
      // the three formats it accepts and which of them can no longer be
      // verified at all.
      password: {
        hash: hashPassword,
        verify: verifyPassword,
      },
      sendResetPassword: async ({ user, url }, _request) => {
        if (process.env.RESEND_API_KEY) {
          const { success, error } = await sendEmail(
            {
              to: user.email,
              subject: 'Reset your password',
              html: `<p>Use this link to reset your password: <a href="${url}">${url}</a></p><p>If you didn't request this, you can ignore this email.</p>`,
            },
            process.env.RESEND_API_KEY
          )
          if (!success) {
            logError(error, { context: '[Password reset] Failed to send email' })
          }
        } else {
          // M3: the reset URL is NOT logged. It embeds a valid, unexpired reset
          // token, so writing it here turned every log reader — and every log
          // shipper, aggregator and backup — into an account-takeover path the
          // moment RESEND_API_KEY was missing in a deployed environment.
          // Knowing a reset could not be delivered is the useful part; the token
          // is not.
          logger.warn(
            { userId: user.id },
            '[Password reset] RESEND_API_KEY not set — reset email NOT sent (link withheld from logs)'
          )
        }
      },
      onPasswordReset: async ({ user }, _request) => {
        logger.info({ userId: user.id }, 'Password reset completed')

        // Choosing a new password through the e-mailed link is the person replacing
        // whatever an admin set (F20), so it ends the must-change state. Cleared BEFORE
        // the revoke below, which also drops the session cache. Best-effort for the
        // same reason as the revoke: the password is already written.
        try {
          await clearPasswordChange(db, user.id)
        } catch (err) {
          logError(err, {
            context: '[auth] clearing must-change after reset failed',
            userId: user.id,
          })
        }

        // A password change and a session revocation are not separable — the
        // whole point of a reset is that whoever held the old credential is
        // out. `revokeSessionsOnPasswordReset` above only reaches Better
        // Auth's own `session` table; this reaches the rest of the contract in
        // lib/account-sessions.ts (legacy staff_sessions rows, the stateless
        // kiosk operator tokens via their epoch, the session cache and the
        // resolved-permission cache).
        //
        // Best-effort: the password has already been written and committed by
        // the time this hook runs, so throwing here would report a failed
        // reset for one that actually succeeded. A failure is logged and
        // recorded instead.
        try {
          await revokeAllSessionsForUser(db, user.id)
        } catch (err) {
          logError(err, {
            context: '[auth] session revoke on password reset failed',
            userId: user.id,
          })
          recordAuthEvent({
            event: 'password_reset_complete',
            outcome: 'failure',
            userId: user.id,
            identifier: user.email,
            reason: 'revoke_failed',
          })
          return
        }

        recordAuthEvent({
          event: 'password_reset_complete',
          outcome: 'success',
          userId: user.id,
          identifier: user.email,
        })
      },
    },
    secret: process.env.BETTER_AUTH_SECRET!,
    baseURL: process.env.BETTER_AUTH_URL!,
    // Rate limiting — persisted to Postgres so counters survive restarts
    // and shard correctly across horizontally-scaled backend instances.
    // The `rateLimit` table (see schema/auth.ts + migration 0082) holds the
    // per-key counters. Better Auth's Drizzle adapter reads/writes them on
    // every auth call. Custom rules tighten the most-targeted endpoints
    // (sign-in, password reset) beyond the global default.
    rateLimit: {
      enabled: true,
      // In local dev the backend talks to a remote (Neon) database, so the
      // database-backed rate limiter adds a read+write round-trip to every auth
      // call (~hundreds of ms on the sign-in path). Use in-memory counters
      // locally; keep the shared DB store for staging/production, where multiple
      // horizontally-scaled instances must agree on the counters.
      storage: isDevEnvironment() ? 'memory' : 'database',
      modelName: 'rateLimit',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60, max: 5 },
        // Better Auth 1.6 renamed this endpoint. The old key matched nothing,
        // so password reset had only the global 100/min rule. Both are listed
        // because a stale key is silently inert rather than an error.
        '/request-password-reset': { window: 60 * 15, max: 3 },
        '/forget-password': { window: 60 * 15, max: 3 },
      },
    },
    advanced: {
      cookiePrefix,
      useSecureCookies: isHttps,
      // Client identity for the rate limiter. Better Auth defaults to
      // ['x-forwarded-for'], which any caller can set — rotating it handed out a
      // fresh bucket per request and defeated the /sign-in/email limit entirely
      // (verified). Pin it to the single header the trusted proxy sets.
      //
      // Note Better Auth FAILS OPEN: when no listed header matches and the
      // process is not in dev/test, getIp() returns null and the limiter is
      // skipped with a warning. So this value must match whatever actually
      // fronts the origin — keep it in step with TRUSTED_IP_HEADER in
      // lib/rate-limiter.ts.
      ipAddress: {
        ipAddressHeaders: [(process.env.TRUSTED_IP_HEADER ?? 'cf-connecting-ip').toLowerCase()],
      },
      ...(isHttps && {
        defaultCookieAttributes: isSameSiteWithFrontend
          ? {
              // Same-site: frontend + backend share deneldental.com, use Lax + parent domain
              secure: true,
              domain: COOKIE_DOMAIN,
              sameSite: 'lax',
            }
          : {
              // Cross-site (Render backend + CF Pages frontend): SameSite=None
              // is required for the browser to send the cookie cross-origin, and
              // SameSite=None mandates Secure.
              secure: true,
              sameSite: 'none',
            },
      }),
    },
    // Pull trusted origins from the same env var as CORS so they stay in sync.
    // Local dev origins are kept hardcoded as a fallback.
    trustedOrigins: [
      'http://localhost:3000',
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:5175',
      'http://localhost:5176',
      ...(process.env.ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ],
    // Better Auth owns every session-revoking endpoint (/sign-out,
    // /revoke-session*, /delete-user, the admin ban/remove routes, …), but the
    // cross-request session cache in rbac/session-cache.ts sits outside that
    // kernel and cannot see those revocations. Without this hook a signed-out
    // cookie kept working for up to AUTH_SESSION_CACHE_TTL_MS (5 s) on every
    // non-/api/auth route.
    //
    // `hooks.after` runs before the response leaves the process, so the cache is
    // already cold by the time the client could re-present the dead credential.
    // `ctx.path` is basePath relative ('/sign-out'); non-mutating paths are a
    // cheap Set miss.
    //
    // IT RUNS WHETHER OR NOT THE ENDPOINT SUCCEEDED — see `endpointFailed`.
    hooks: {
      // Second layer for `update-user`: an allowlist, not a denylist. `input:
      // false` above covers the fields we know about; this refuses anything else
      // a plugin or a future column adds, including the username plugin's own
      // fields, which cannot be locked from this config. The whole request is
      // rejected — a forbidden key must not ride along with `name`.
      before: createAuthMiddleware(async (ctx) => {
        // F20 — a forced password change that accepts the same password is no change:
        // the admin who set it would still know it. Better Auth does not check.
        if (ctx.path === '/change-password') {
          const pair = (ctx.body ?? {}) as { currentPassword?: unknown; newPassword?: unknown }
          if (typeof pair.newPassword === 'string' && pair.newPassword === pair.currentPassword) {
            throw new APIError('BAD_REQUEST', {
              message: 'Choose a password different from your current one.',
            })
          }
          return
        }
        if (ctx.path !== '/update-user') return
        const body = (ctx.body ?? {}) as Record<string, unknown>
        const refused = Object.keys(body).filter((key) => !SELF_EDITABLE_USER_FIELDS.has(key))
        if (refused.length === 0) return
        logger.warn({ fields: refused }, '[auth] update-user refused: non-editable fields sent')
        throw new APIError('BAD_REQUEST', {
          message: 'Only name and image can be changed on your own profile.',
        })
      }),
      after: createAuthMiddleware(async (ctx) => {
        // F20 / D8 — keep `user.mustChangePassword` in step with who chose the password.
        // Written BEFORE the session cache is dropped just below, so the next request
        // re-reads the new value rather than re-caching the old one.
        //
        // The person changed their own password: the admin-known one is gone. The id
        // comes from the response, because with revokeOtherSessions the session that
        // made the call no longer exists to be looked up.
        if (ctx.path === '/change-password' && !endpointFailed(ctx)) {
          const userId = (ctx.context.returned as { user?: { id?: unknown } } | undefined)?.user?.id
          if (typeof userId === 'string' && userId) {
            try {
              await clearPasswordChange(db, userId)
            } catch (err) {
              logError(err, { context: '[auth] clearing must-change failed', userId })
            }
          }
        }

        // An admin set someone else's password through Better Auth's own admin
        // endpoint, bypassing the routes that flag it. Flag it here, unless they set
        // their own.
        if (ctx.path === '/admin/set-user-password' && !endpointFailed(ctx)) {
          const targetId = (ctx.body as { userId?: unknown } | undefined)?.userId
          const actor = await getSessionFromCtx(ctx).catch(() => null)
          if (typeof targetId === 'string' && targetId && targetId !== actor?.user?.id) {
            try {
              await requirePasswordChange(db, targetId)
            } catch (err) {
              logError(err, { context: '[auth] flagging must-change failed', userId: targetId })
            }
          }
        }

        // Deliberately unconditional: dropping cached sessions can only ever
        // deny access, never grant it, so flushing after a failed call is
        // wasted work rather than a hazard.
        if (invalidateSessionCacheForAuthPath(ctx.path)) {
          logger.debug({ path: ctx.path }, '[auth] session cache invalidated')
        }

        // Better Auth's /admin/ban-user deletes its own `session` rows but knows
        // nothing about the other mechanisms, so route it through the shared
        // revoke. /admin/remove-user needs no equivalent: staff_sessions.userId
        // cascades on user delete.
        //
        // The success check is load-bearing, not defensive tidiness. Without it
        // this hook fired on REJECTED calls too, so an unauthenticated POST to
        // /admin/ban-user carrying any userId revoked that user's sessions
        // while the attacker got a 401 — remote, unauthenticated logout of any
        // account whose id appears in an API response. Verified and fixed
        // 2026-09-21; see project-docs/auth-security-audit.md.
        if (ctx.path === '/admin/ban-user' && !endpointFailed(ctx)) {
          const userId = (ctx.body as { userId?: unknown } | undefined)?.userId
          if (typeof userId === 'string' && userId) {
            try {
              await revokeAllSessionsForUser(db, userId)
              recordAuthEvent({ event: 'ban', outcome: 'success', userId })
            } catch (err) {
              logError(err, { context: '[auth] staff-session revoke on ban failed', userId })
              recordAuthEvent({
                event: 'ban',
                outcome: 'failure',
                userId,
                reason: 'revoke_failed',
              })
            }
          }
        }
      }),
    },
    plugins: [
      admin(),
      // Lets our own code create a session for a user (staff phone+OTP login,
      // kiosk operator hand-off) inside the kernel, so the cookie, hooks and
      // ban check all apply. Refuses any call that arrived over HTTP — see the
      // module header; unguarded it would be an authentication bypass.
      serverSession(),
      // NOTE: Better Auth's `phoneNumber()` plugin was registered here in stage 1
      // and has been REMOVED. It was never adopted: staff phone+OTP is served by
      // routes/staff-auth.ts + lib/staff-otp.ts, which enforce the active-staff
      // lookup the plugin cannot (its own /phone-number/send-otp texts ANY
      // number). Nothing called its endpoints — every OTP went to
      // `staff_otp_codes` and `verification` stayed empty.
      //
      // Leaving it registered was not neutral. Every plugin endpoint is mounted
      // under /api/auth/*, so it published an UNAUTHENTICATED
      // POST /api/auth/phone-number/send-otp that sent an SMS to any number on
      // earth at the clinic's Hubtel expense — verified: 200 "code sent" for a
      // number with no account. With Better Auth's IP rate limiter skipping
      // whenever no client address resolves, nothing capped it.
      //
      // Do not re-add it without a flow that actually needs it AND a gate in
      // front of send-otp. See project-docs/auth-consolidation-plan.md.
      // PWA staff sign in by staffId (FDM-S0001). The default username
      // validator rejects dashes, so allow them explicitly. Portal sign-ins
      // use signIn.email and bypass this validator entirely.
      username({
        usernameValidator: (value) => /^[a-zA-Z0-9_-]+$/.test(value),
        displayUsernameValidator: (value) => /^[a-zA-Z0-9_-]+$/.test(value),
      }),
    ],
  })
}

type AuthInstance = ReturnType<typeof buildAuth>

/**
 * One Better Auth instance per distinct configuration, not per request.
 *
 * `getAuth(c)` is called 2–3× on an authenticated request (the interface-scope
 * guard, the route's own session read, sometimes the handler itself) and each
 * call used to rebuild the entire kernel: adapter wiring, plugin endpoint
 * tables, route table, rate-limit state. None of that depends on the request
 * beyond the four values in AuthBuildOptions, so it is memoised on exactly
 * those (plus DATABASE_URL, which selects the adapter's pool).
 *
 * The key space is tiny and bounded — four cookie prefixes × http/https ×
 * same-site/cross-site × one connection string — so the map never grows.
 *
 * Interaction with the session cache: memoising the *kernel* does not memoise
 * any *session*. `auth.api.*` and `auth.handler` are handed the live request
 * headers on every call, so a memoised instance still reads the database. The
 * `hooks.after` closure registered above is likewise per-instance but stateless
 * — it only clears the module-level cache in rbac/session-cache.ts, which every
 * instance shares. Sign-out through any cookie prefix therefore invalidates
 * cached resolutions for all of them.
 */
const authInstances = new Map<string, AuthInstance>()

/**
 * Which cookie prefix this request's session will be read from.
 *
 * Exported because the session-resolution cache in `rbac/session-cache.ts` has
 * to key on it. That cache hashes the Cookie header, but WHICH cookie in that
 * header counts as the session is decided here, by `X-App-Id` — so two requests
 * with identical cookies and different app ids resolve to different users.
 * Cookies are scoped to `.deneldental.com`, so a browser signed into the portal
 * and the Team app sends both tokens to `api.deneldental.com` on every request, and
 * without this in the key whichever app asked first owned the cached answer for
 * both. See `credentialKey`.
 */
export function resolveCookiePrefix(c: Context<HonoEnv>): string {
  // Each frontend sends X-App-Id so the backend can assign an isolated cookie
  // prefix without fragile origin-sniffing. This prevents session collisions
  // when multiple apps share a domain (especially on localhost in dev).
  //
  // Not every caller sets the header, though — e.g. bare fetches that don't go
  // through the shared api-client (the portal's /api/auth/permissions probe), or
  // top-level new-tab navigations that open a backend URL directly (the "Download
  // statement" / receipt-print links, which browsers can't attach headers to).
  // Fall back through progressively weaker signals so those still resolve to the
  // right cookie prefix instead of defaulting to 'pwa' (staff-pwa.session_token)
  // and 401ing despite a valid portal.session_token:
  //   1. Origin-derived interface (detectInterface middleware)
  //   2. Referer-derived interface — a new-tab navigation carries no Origin but
  //      still sends the Referer of the page that opened it (e.g. the portal).
  const ifaceFromOrigin =
    c.var.interface && c.var.interface !== 'unknown' ? c.var.interface : undefined
  let ifaceFromReferer: string | undefined
  if (!ifaceFromOrigin) {
    const referer = c.req.header('Referer')
    if (referer) {
      try {
        const derived = deriveInterface(new URL(referer).origin)
        if (derived !== 'unknown') ifaceFromReferer = derived
      } catch {}
    }
  }
  const appId = c.req.header('X-App-Id') ?? ifaceFromOrigin ?? ifaceFromReferer ?? 'pwa'
  // Each Better-Auth app gets its own cookie prefix so sessions never collide
  // when multiple apps share a browser / domain. hr had been falling into the
  // generic 'staff-pwa' bucket — give it its own. Unknown callers keep the
  // legacy 'staff-pwa' default.
  //
  // `patient` is mapped for the same reason hr was: the Patient app sends
  // `X-App-Id: patient` and Team sends `pwa`, so both used to fall through to
  // `staff-pwa.session_token` and clobber each other. Cookies are port-agnostic,
  // so on localhost that collision fires regardless of dev-server ports.
  //
  // Team is deliberately LEFT on the legacy 'staff-pwa' default rather than
  // given a 'pwa' entry: renaming its prefix would invalidate every live staff
  // session on deploy. Mapping `patient` alone breaks the collision, and the
  // Patient app is the newer of the two. Give Team its own prefix only as a
  // deliberate, announced change.
  return (
    { portal: 'portal', reports: 'reports', hr: 'hr', patient: 'patient' }[appId] ?? 'staff-pwa'
  )
}

/**
 * Returns the Better Auth instance for this request's configuration, building
 * it on first use.
 */
export function getAuth(c: Context<HonoEnv>): AuthInstance {
  const connectionString = process.env.DATABASE_URL!
  const requestHostname = new URL(c.req.url).hostname
  const isLocalhost = requestHostname === 'localhost' || requestHostname === '127.0.0.1'
  const isHttps = !isLocalhost

  const cookiePrefix = resolveCookiePrefix(c)

  // Same-site requires BOTH the frontend and the backend to share deneldental.com.
  // Checking only BETTER_AUTH_URL is insufficient: in staging the backend is on
  // Render (*.onrender.com) but frontends are on *.pages.dev — different
  // registrable domains — so the cookie must be SameSite=None to flow at all.
  // The decision lives in lib/same-site.ts alongside the cookie domain it pairs with.
  const origin = c.req.header('Origin') || c.req.header('Referer') || ''
  const isSameSiteWithFrontend = sharesSiteWithBackend(origin, process.env.BETTER_AUTH_URL, isHttps)

  const key = `${cookiePrefix}|${isHttps}|${isSameSiteWithFrontend}|${connectionString}`
  const existing = authInstances.get(key)
  if (existing) return existing

  const instance = buildAuth({
    db: getDb(connectionString),
    cookiePrefix,
    isHttps,
    isSameSiteWithFrontend,
  })
  authInstances.set(key, instance)
  return instance
}
