# Authentication Security & Architecture Audit

> **Status 2026-09-21 — every Critical and High finding is FIXED** against a clean
> backend instance. Sign-up now returns `EMAIL_PASSWORD_SIGN_UP_DISABLED`; the
> three `sync.ts` endpoints return 401; the credential logging is gone. The
> remaining findings below are open. Fix details are at the bottom.

**Date:** 2026-09-20 · **Scope:** backend authentication and directly related
authorization machinery. Kiosk device pairing and operator PIN are **excluded**
by request.

Every finding below was read in source. Findings marked **PROVEN** were also
reproduced against the running backend; the command is given so you can repeat
it. Nothing here is inferred from naming or comments alone.

---

## Summary

The core primitives are good: argon2id at OWASP 2024 parameters, opaque
server-stored session tokens hashed at rest, CSPRNG OTPs with modulo-bias
rejection, HMAC-signed reset tokens, a documented session cache with an
explicit invalidation hook. Someone has thought carefully about this.

The weaknesses are not in the primitives. They are in **where enforcement
lives** and **what the system trusts**:

1. Authorization is enforced *inside handlers*, through six different idioms,
   with no single choke point. Coverage cannot be verified statically — I had
   to probe the running server to establish it.
2. The system trusts client-supplied headers for two security decisions:
   rate-limit identity (`X-Forwarded-For`) and interface scope (`Origin` /
   `X-App-Id`). Both are bypassable.
3. There are two parallel authentication stacks (Better Auth and a custom staff
   session/reset path) with different revocation semantics, and the custom one
   bypasses the hooks the other relies on.

---

## Critical

### C1 — Plaintext passwords written to logs on every sign-in

`backend/src/lib/password.ts`, first line of `verifyPassword`:

```ts
console.log('[auth/verifyPassword] args:', args)
```

`args` is `{ password, hash }`. Every successful and failed sign-in prints the
user's **cleartext password** and the argon2 hash to stdout, which in production
is the container log stream and whatever aggregator consumes it.

This also defeats the argon2 work factor entirely: anyone with log read access
has the passwords directly.

**Fix:** delete the line. Then treat existing logs as compromised — they contain
credentials for every user who has signed in since it was added.

### C2 — Sign-in rate limit is bypassable; no account lockout — PROVEN

Better Auth is configured with `'/sign-in/email': { window: 60, max: 5 }`, keyed
on the client IP, which it derives from `X-Forwarded-For` by default
(`advanced.ipAddress` is not configured). The header is attacker-controlled.

```bash
# 8 attempts, same XFF   → 401 401 401 401 401 429 429 429   (limit works)
# 8 attempts, rotating   → 401 401 401 401 401 401 401 401   (never limited)
for i in $(seq 1 8); do curl -s -o /dev/null -w "%{http_code} " \
  -X POST http://localhost:3000/api/auth/sign-in/email \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:5173' \
  -H "X-Forwarded-For: 198.51.100.$i" \
  -d '{"email":"nobody@example.invalid","password":"wrong"}'; done
```

There is **no account-level lockout or throttle** anywhere — the only control is
this per-IP limit. Together that means unlimited password guessing against any
known account from a single host.

The same flaw applies to the custom limiter in `lib/rate-limiter.ts`:

```ts
export function clientIp(c: Context): string | null {
  return c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? null
}
```

No proxy allow-list, no hop selection — `X-Forwarded-For` is a comma-separated
chain and the whole string becomes the bucket key. Used by
`appointment-workflow`, `staff-attendance` and `website-bookings`.

**Fix:** pin the trusted proxy hop (on Hetzner behind Docker, take the
rightmost untrusted hop, or trust only Cloudflare's ranges and use
`CF-Connecting-IP` exclusively); add a per-account failure counter with
exponential backoff independent of IP.

---

## High

### H1 — Public unauthenticated sign-up is enabled — PROVEN

`emailAndPassword.enabled: true` with no `disableSignUp`, so Better Auth mounts
`/api/auth/sign-up/email` and the catch-all in `app.ts` passes it straight
through.

```bash
curl -X POST http://localhost:3000/api/auth/sign-up/email \
  -H 'Content-Type: application/json' -d '{}'
# → 400 VALIDATION_ERROR  (route is live; a valid body creates a user)
```

A self-registered user lands with `roleId: null`, so RBAC denies module access —
but they hold a valid session against a clinical API, they pollute the `user`
table that staff records join to, and every route that only checks
*authentication* (see H3) is reachable.

**Fix:** `emailAndPassword: { disableSignUp: true }`. Staff accounts are created
through the admin/HR flows; nothing legitimate calls this endpoint.

### H2 — Unauthenticated write endpoint — PROVEN

`backend/src/routes/sync.ts` is mounted with no middleware, and three of its
handlers perform no auth call while their neighbours in the same file do:

| Endpoint | |
|---|---|
| `GET /api/sync/treatment-types` | unauthenticated read |
| `GET /api/sync/history` | unauthenticated read |
| `PATCH /api/sync/treatment-types/:id` | **unauthenticated write** |

CSRF does not save this, because the CSRF token is issued to anyone:

```bash
TOK=$(curl -s -c /tmp/cj http://localhost:3000/api/csrf | jq -r .token)
curl -s -b /tmp/cj -X PATCH \
  http://localhost:3000/api/sync/treatment-types/00000000-0000-4000-8000-000000000000 \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $TOK" -d '{"enabled":true}'
# → {"success":true}
```

Zero rows changed only because `treatment_types` is empty in dev. **CSRF is not
an authorization control** — it prevents cross-site forgery, not direct calls.
Anywhere the code relies on it as a gate is unguarded.

Also unauthenticated: `GET /api/settings/low-stock-threshold` (low impact, but
it is an ungated data read in a file whose sibling POST is gated).

### H3 — Interface scope is bypassable by omitting `Origin`

`enforceInterfaceScope` only gates when `c.var.interface` resolves to
`portal | pwa | hr`, which comes solely from an `Origin` allow-list. Omit the
header and you get `unknown`, which the guard explicitly passes through.

`resolveAppScope` then falls back to the **client-declared** `X-App-Id`, and its
final default is `portal`:

```ts
const appId = c.req.header('X-App-Id')
if (appId === 'pwa') return 'pwa'
if (appId === 'hr') return 'hr'
return 'portal'          // ← default when Origin is absent/unknown
```

So any authenticated user can strip `Origin` from a scripted request and skip
interface enforcement entirely. Browsers always send `Origin` cross-origin,
which is the deployed topology, so this is an insider/scripted-client path, not
a CSRF path.

> **Correction (2026-09-21).** This finding originally also claimed the caller
> gained the portal permission matrix. That part was wrong.
> `applicableBundleScopes` maps `pwa → ['pwa','all']` and `portal →
> ['portal','all']`, so a pwa-only role resolving as portal gets *fewer*
> bundles, not more — no permission is gained. The defect is narrower than
> written: the **interface gate is skipped**, i.e. the layer this file's own
> comments call "the mechanism that keeps doctors and admins out of the Team
> app" was bypassable by deleting a header. Module permissions still applied
> throughout.

**Fix:** treat a missing/unrecognised `Origin` on an authenticated request as a
denial rather than a pass, or resolve scope from the session's granted scopes
rather than from a request header.

### H4 — The custom password reset bypasses Better Auth and revokes nothing

`POST /api/staff-portal/forgot-password/reset` writes the new hash straight into
the `account` table:

```ts
await db.update(account)
  .set({ password: hashedPassword, updatedAt: new Date() })
  .where(and(eq(account.userId, staffMember.userId), eq(account.providerId, 'credential')))
await revokeAllStaffDevices(db, staffMember.id)
```

Consequences:

- **No session revocation.** Better Auth `session` rows and `staff_sessions`
  rows both survive a password reset. An attacker who has a live session keeps
  it after the victim resets; an attacker who resets does not dislodge the
  victim. `revokeAllStaffDevices` clears *device trust*, not sessions.
- **No cache invalidation.** `SESSION_MUTATING_AUTH_PATHS` lists
  `/reset-password`, but that is Better Auth's own path. This route never enters
  the kernel, so `hooks.after` never fires.
- **The reset token is replayable.** It is a stateless HMAC with a 15-minute
  expiry and no nonce or usage record, so it can reset the password repeatedly
  within the window.

**Fix:** route the write through Better Auth's password API, or at minimum
delete all `session` + `staff_sessions` rows for the user and call
`invalidateSessionCache()`; make the token single-use by recording its jti.

### H5 — Banned and deactivated users keep their custom staff sessions

`getSessionStaff` loads the session, then the user row, and returns it without
checking status:

```ts
const [u] = await db.select().from(schema.user).where(eq(schema.user.id, session.userId)).limit(1)
if (!u) return null
return { user: u, sessionId: session.id }
```

The `user` table has `banned` (Better Auth admin plugin). Better Auth's own
`getSession` honours it; this path does not. Banning a user through
`/api/auth/admin/ban-user` revokes Better Auth sessions but never touches
`staff_sessions`, so a banned staff member stays signed in on the Team PWA for
up to the 30-day session TTL.

`revokeAllStaffSessions` exists but is called from only two places in
`staff-core.ts`.

**Fix:** check `banned` (and any active/deleted flag) in `getSessionStaff`, and
hook staff-session revocation into every deactivation and ban path.

---

## Medium

### M1 — Phone-number enumeration in the forgot-password flow

Step 1 is carefully enumeration-resistant — same message on every path. Step 2
undoes it:

```ts
if (!staffMember) return c.json({ error: 'Invalid phone number or OTP' }, 400)
const result = await verifyStaffOtp(...)
if (!result.ok) return c.json({ error: result.error ?? '...' }, 400)
```

Unknown phone → `"Invalid phone number or OTP"`.
Known phone, no active code → `"Code not found or expired. Request a new one."`
Known phone, wrong code → `"Incorrect code. 4 attempts remaining."`

Three distinguishable responses. Submit any code and read the message.

Step 1 also leaks by **timing** despite the constant message: a known phone runs
a count query, an insert, a branding read and an outbound SMS HTTP call; an
unknown phone returns after one lookup. The comment claims otherwise.

### M2 — No audit logging of authentication events

`audit_logs` exists and is written by analytics, xrays, HR and kiosk routes.
Nothing in the auth path writes to it: no sign-in success or failure, no
sign-out, no password reset, no OTP issue or verify, no session creation, no
role or scope change.

You cannot answer "who signed in, from where, when", cannot detect credential
stuffing, and have no trail for a clinical-records compliance review. For a
system holding patient data this is a baseline control, not a nice-to-have.

### M3 — Reset links written to logs when email is unconfigured

```ts
} else {
  logger.info({ email: user.email, url }, '[Password reset] RESEND_API_KEY not set; link for user')
}
```

If `RESEND_API_KEY` is ever unset in a deployed environment, every password
reset link lands in the logs as a usable account-takeover token.

### M4 — OTP verification is a non-atomic read-modify-write

`verifyStaffOtp` selects the code, compares, then updates in separate
statements. Two concurrent requests with the correct code can both pass before
`usedAt` is set (**OTP replay**), and concurrent wrong guesses can both write
`attempts + 1` from the same base, undercounting against the 5-attempt cap.

**Fix:** `UPDATE ... WHERE id = ? AND used_at IS NULL RETURNING id` and treat a
zero-row result as already-used; increment attempts with `attempts = attempts + 1`.

### M5 — Caches do not invalidate across instances

Both the session cache (`rbac/session-cache.ts`, 5s) and the permission cache
(`rbac/engine/CacheManager.ts`, 10s) are process-local `Map`s. `invalidateSessionCache()`
clears only the instance that handled the request.

The permission cache documents this honestly as a known v2 limitation. The
session cache does not: its comment says a revoked credential "is therefore
rejected on the very next request", which holds for a single instance but not
for the horizontally-scaled deployment the rate-limiter config explicitly
targets. On multi-instance, sign-out leaves other instances accepting the
credential for up to the TTL.

### M6 — Staff session lifecycle

- 30-day TTL, no idle timeout, no rotation on privilege change.
- `lastUsedAt` is written on **every authenticated request**, fire-and-forget
  with `.catch(() => {})`. That is one UPDATE per request against a hot row plus
  the WAL cost, and failures are silent. Under load this is the first thing that
  will hurt.

---

## Low / maintainability

| # | Finding |
|---|---|
| L1 | **Six authorization idioms**: middleware pair, `lib/rbac` handler shim, router-level `.use('/*')`, local `requireAdmin`, local `checkAdmin`, local `getStaffForUser`. Coverage is unverifiable statically — I produced three different wrong counts before resorting to live probes. Consolidate onto one enforced-by-default pattern. |
| L2 | `seed.ts` ships `POST /populate` and `DELETE /clear` (deletes patients, appointments, medical records, payments) in the production build, gated only by admin role. Should be compiled out unless `APP_ENV=development`. |
| L3 | Two parallel session systems with different cookie flags, TTLs and revocation paths. `verifySession` probes staff first, then Better Auth. Every future auth change has to be made twice. |
| L4 | Origin→interface map is hardcoded in `detectInterface.ts` while CORS origins come from `ALLOWED_ORIGINS`. Two sources of truth that must agree; they already drifted once (the comment records portal and team resolving to `unknown` in production). |
| L5 | `CacheManager` header says TTL 60s; the constant is 10s. |
| L6 | `readCookie` builds `new RegExp('staff_session=([^;]+)')` unanchored — a cookie named `x_staff_session` also matches. Anchor on `(?:^|;\s*)`. |
| L7 | `staff-session.ts` picks cookie attributes from `env.APP_ENV === 'development'`. `APP_ENV` is unset in this clone, so local dev emits `Secure; SameSite=None` over plain HTTP and the browser drops the cookie — staff phone+OTP login cannot work locally. Same unset var disables the dev upload fallback. |
| L8 | `verifyPassword(args: any, ...extra: any[])` accepts two calling conventions and is untyped; the positional branch also logs the hash. |
| L9 | Password policy is length ≥ 8 only — no complexity, no breach-list check, no reuse prevention. |
| L10 | OTP codes are stored as bare SHA-256. A 6-digit space is exhaustible instantly from a DB read. HMAC with a server-side key would make stolen rows useless. |
| L11 | `isAdmin` is computed two different ways — `roleId === 'admin'` in `lib/rbac.ts` and `dbUser.roleId === 'admin' \|\| dbUser.role === 'admin'` in `routes/auth.ts`. Two notions of admin, one of which (`role`) is the field Better Auth's admin plugin mutates. |

---

## Suggested order of work

1. **C1** — delete the log line, rotate credentials, treat existing logs as compromised.
2. **H1** — `disableSignUp: true`. One line, closes public account creation.
3. **H2** — add the auth calls to the three `sync.ts` handlers.
4. **C2** — fix IP derivation, then add per-account lockout.
5. **H4 / H5** — make reset and ban revoke every session type.
6. **H3** — stop trusting `X-App-Id`; fail closed on unknown `Origin`.
7. **M2** — auth audit logging.
8. **L1** — consolidate the enforcement idioms so the next audit can be static.

Items 1–3 are single-line or single-function changes. Items 4–6 need design
decisions about the proxy topology and about whether the custom staff session
stack should continue to exist alongside Better Auth.


---

## Fixed — 2026-09-21

| ID | Change | Verified |
|---|---|---|
| **C1** | Removed `console.log('[auth/verifyPassword] args:', args)` and the positional-branch hash log from `lib/password.ts`. | `grep console.log` → none |
| **H1** | `emailAndPassword.disableSignUp: true` in `auth.ts`. | `POST /api/auth/sign-up/email` with a **valid** body → `400 EMAIL_PASSWORD_SIGN_UP_DISABLED`; `select count(*) from "user" where email like '%example.invalid%'` → `0` |
| **C2** | Two halves. (a) Client identity pinned to one proxy-set header — `clientIp()` reads `TRUSTED_IP_HEADER` (default `cf-connecting-ip`) with no fallback chain, and Better Auth's `advanced.ipAddress.ipAddressHeaders` pinned to the same value (its default was `['x-forwarded-for']`, which is what the bypass used). Callers fail closed via `requireClientIp()` / `TRUSTED_IP_MODE` instead of the shared `'unknown'` bucket. Limiter eviction is now actually bounded. (b) Per-account throttle, IP-independent, exponential backoff — `lib/login-limiter.ts`, wired into `/api/auth/sign-in/email` in `app.ts`. Infrastructure half is specified in `api-edge-topology.md` and is **not yet applied**. | Rotating `X-Forwarded-For` + `CF-Connecting-IP` every request: `401 ×5` then `429 ACCOUNT_TEMPORARILY_LOCKED` with `Retry-After: 45` (previously 8 × `401`, never limited). A different account signed in normally while the first was locked. Successful sign-in cleared the failure rows (1 → 0). |
| **H2** | Added the file's existing `getCurrentUser` + `checkPermission` guard to the three unguarded `sync.ts` handlers (`DATA_SYNC` READ / UPDATE / READ). | all three → `401` (previously `200`) |

Verification was run against a throwaway backend on port 3011 because the
long-running dev backend does not hot-reload (its `tsx watch` parent is alive
but the child serves stale code — worth fixing separately, it has now masked
two changes).

**C1 follow-up still outstanding:** any log stream that captured sign-ins while
that line was present contains cleartext passwords. Those logs should be purged
and the affected users' passwords rotated.
| **H5** | Two layers. (a) `getSessionStaff()` now rejects banned accounts at point of use, matching Better Auth's `banExpires` semantics exactly, and deletes the dead row. (b) Revocation at the mutation: the offboard transaction in `access-management.ts` now deletes both `session` and `staff_sessions` rows, and `hooks.after` in `auth.ts` revokes staff sessions on `/admin/ban-user`. `/admin/remove-user` needs nothing — `staff_sessions.userId` cascades. | Live staff session → `200`. Set `banned = true` → same cookie `401`, and the `staff_sessions` row self-deleted (1 → 0). Unbanned → sign-in `200` again. |
| **H3** | `enforceInterfaceScope` now gates on `resolveAppScope(c)` — the same function `checkPermission` uses to choose the permission matrix — instead of on `c.var.interface` (Origin only). You are always gated on the scope your permissions resolve against, whichever signal supplied it, so an unattributable request is gated as portal rather than waved through. `resolveAppScope` also gained a Referer fallback, without which new-tab download/print links from the Team app would have been gated as portal and 403'd for pwa-only roles. | With a `lab_technician` session (pwa scope only), against `/api/staff-portal/dashboard`. 403 = gate denied, 401 = gate passed and the route's own check failed: Origin team → 401 · Origin portal → 403 · **no Origin, no Referer → 403** (was ungated) · no Origin + Referer team → 401 · no Origin + `X-App-Id: portal` → 403. Re-run under `SCOPE_ENFORCEMENT=dryrun`: the same two requests return 401 with 2 "would block request" log entries, confirming the 403s are this gate. |
| **H4** | Direction chosen: **unify the contract, do not merge the stacks** (option C, pre-launch, user decision). New `lib/account-sessions.ts` holds three primitives every surface now uses: `isAccountDisabled()`, `revokeAllSessionsForUser()` (Better Auth `session` + `staff_sessions` + cache invalidation), and `setUserPassword()` (write **and** revoke as one operation). The staff reset is now single-use: the HMAC payload carries a fingerprint of the password it was issued against, so it dies the moment it is spent — no new table. | `typecheck` + production build clean. All six revocation sites and all password-write sites now route through the shared primitives (see call-site map below). |

### Notes from fixing H4 — what the contract found

Adopting one interface immediately surfaced three more instances of the same
bug that nobody had reported:

1. **`staff-core.ts` deactivate and delete** revoked `staff_sessions` only, so
   a deactivated doctor or receptionist kept their **portal** (Better Auth)
   session — while the comment claimed they were "signed out everywhere
   immediately".
2. **`staff-core.ts` admin password reset** wrote the new hash and revoked
   nothing, so resetting the password of a suspected-compromised account left
   every live session working.
3. **`users.ts`** calls Better Auth's own `auth.api.setUserPassword`, which
   turns out to call `internalAdapter.updatePassword` and nothing else — **no
   session delete**. Same defect, in the library's own admin API.

That is the argument for option C in one paragraph: the mechanisms were not
the problem, the absence of a shared contract was. `revokeAllStaffSessions()`
was deleted rather than left beside the new helper — revoking one mechanism and
not the others is precisely the bug it kept causing.

Deliberately **not** covered: `patient_sessions` (keyed on patient id, not a
`user` id — belongs with the patient auth flow) and the kiosk's device auth
(out of audit scope, though note `kiosk.ts:952` issues a staff session, so any
future consolidation onto Better Auth touches it).

### Notes from fixing H3

`SCOPE_ENFORCEMENT=dryrun` still works as the rollout valve and was used to
A/B the change. If the wider gating causes trouble in production, set it to
`dryrun` to observe rather than block — but read the warning in that file's
header first: it defaulted to `dryrun`, was set nowhere, and therefore enforced
nothing for its entire life.

Roles and their scopes at the time of the fix, which is what determines blast
radius: `admin` portal+hr · `doctor` portal · `receptionist` portal+pwa ·
`hr_admin` hr · `external_trainer` hr · `lab_technician` pwa · `staff` pwa.
Note `admin` does **not** hold pwa — that is deliberate.

### Notes from fixing H5

The audit understated this. Better Auth enforces bans in a `session.create`
hook — it blocks the *next* sign-in — and only its own `/admin/ban-user`
endpoint deletes session rows. The offboard path in `access-management.ts`
writes `banned: true` straight to the column, so it bypassed that entirely and
revoked **nothing**: not `staff_sessions`, and not Better Auth's own `session`
rows either. Its comment claimed "any open session is locked out", but
invalidating the permission cache only forces a re-resolve; it does not end a
session.

Hence the check at point of use rather than only at the ban sites: it covers
every path that sets the column, including ones added later.


`lib/patient-login-limiter.ts` already existed — DB-backed, restart-safe,
horizontal-scale safe — and **had zero importers**. The code was written and
never wired to a route. Rather than add a seventh mechanism it was renamed to
`lib/login-limiter.ts`, given the IP-independent layer, and connected. Its
existing table covered the need, so **no migration was required**.

Worth a sweep for other dead security code: a control that is written but never
called reads as present in review and is absent in production.

### Still open

All Medium and Low items. No Critical or High finding remains open.

> **Superseded 2026-09-21** by the post-remediation audit below. The
> `phone-number` plugin was **not** the destination — it was removed. And "no
> Critical or High finding remains open" was true only until the fixes
> themselves were re-tested: they had introduced one Critical and three Highs.
> Read the post-remediation section before relying on anything in this
> paragraph.

The four session mechanisms still exist by design (option C). Consolidating the
staff stack onto Better Auth's `phone-number` plugin — which ships in the
version already installed — remains the architectural destination, and is
cheapest **before launch**: afterwards it forces a re-login for every staff
member and touches kiosk stations in the field. The contract added here is the
interface such a consolidation would collapse into, so it makes that work
easier rather than harder. The infrastructure half of C2 —
standing up the tunnel — is specified in `api-edge-topology.md`; until it is
applied, production has the per-account throttle but still derives IPs from an
untrusted header.

---

## Post-remediation audit — 2026-09-21

Everything above was fixed, then the whole auth surface was re-tested end to end
against a running backend and the local database. **The fixes themselves
introduced defects**, one of them worse than anything in the original audit.
This section records what the re-test found. All items here are fixed and
verified unless stated otherwise.

### P1 — CRITICAL, introduced by the H5 fix: unauthenticated remote logout of any account

The H5 fix added a Better Auth `hooks.after` that calls
`revokeAllSessionsForUser` when `/admin/ban-user` is hit. Better Auth runs
after-hooks for **every** request to a path, successful or not — it sets
`context.returned` to the thrown `APIError` and calls the hooks anyway
(`dist/api/to-auth-endpoints.mjs`). The hook read `ctx.body.userId` and revoked
without checking whether the ban had actually happened.

Proven against the running stack — no session, no credentials, no admin rights:

```
victim logged in.  sessions = 1
attacker: POST /api/auth/admin/ban-user  {"userId":"<victim>"}   -> 401
victim sessions now = 0
victim's cookie  -> 401
```

Any userId appearing in an API response was enough. Looped, it keeps every
account permanently signed out.

**Fix:** `endpointFailed(ctx)` in `src/auth.ts`, mirroring better-auth's own
`isAPIError` (including the `name` duck-check, so it survives duplicate copies
of the error class). The revoke is gated on it; the session-cache flush is
deliberately left unconditional, because flushing can only deny access.

Re-verified: attacker gets 401 and the victim's session **survives**; a real
admin ban still revokes (`sessions 1 -> 0`, `banned = t`).

### P2 — HIGH: `isAccountDisabled` was enforced only in the stack being retired

The H5 work created `isAccountDisabled` as "the one contract every
session-bearing surface obeys". A grep found it had exactly **one** call site:
`lib/staff-session.ts` — the legacy custom reader that stages 2–3 had just
stopped issuing sessions from. The Better Auth read path, which now serves
portal, HR, reports, the Team PWA *and* the kiosk, never checked `banned` at
all: Better Auth enforces bans at session **creation**, not on read.

```
banned = true written directly (no revoke); session row left in place
GET /api/auth/permissions  -> 200   <- banned user, fully working
GET /api/patients          -> 200
```

**Fix:** applied in `resolveUser` (`lib/rbac.ts`). Re-verified: both now 401
while banned, and 200 again once the ban is lifted.

### P3 — HIGH: revocation never reached kiosk operator sessions

Kiosk operator sessions are stateless signed tokens invalidated by bumping
`kiosk_operators.sessionEpoch`. `revokeAllSessionsForUser` did not bump it. The
kiosk does check `staff.status`/`deletedAt`, so deactivation and offboarding
locked a person out — but **banning a user, or resetting their password**
(`routes/users.ts`, `staff-core.ts`) touches neither, so a banned staffer could
still unlock a paired station with their PIN.

**Fix:** the epoch bump is now part of `revokeAllSessionsForUser`. Re-verified:
ban -> operator epoch `0 -> 1`.

### P4 — HIGH, introduced by stage 1: an unauthenticated SMS-bombing endpoint

See `auth-consolidation-plan.md` for the full write-up. The `phoneNumber()`
plugin was registered in stage 1 and never used by any flow, but Better Auth
mounts every plugin endpoint under `/api/auth/*` — so it published an
unauthenticated `POST /api/auth/phone-number/send-otp` that sent an SMS to any
number at the clinic's expense (verified: `200 {"message":"code sent"}` for a
number with no account), with nothing capping it. **Plugin and columns removed**
(migration `0216`); the endpoint now 404s.

### P5 — MEDIUM, introduced by the C1 fix: Better Auth's rate limiter fails open

Narrowing `ipAddressHeaders` to the single trusted header (correct for C1) means
that whenever no client address resolves, Better Auth's limiter does not fall
back — it logs **one warning per process** and then skips the limit for every
subsequent request (`if (!ip) return null`). Sign-in was already covered by the
IP-independent identifier throttle. `/request-password-reset` was **not**, and it
sends real email via Resend.

**Fix:** the identifier throttle now also covers password reset, under a
separate `reset:` key so a reset flood cannot lock an account out of sign-in.
Note that Better Auth 1.6 renamed `/forget-password` to
`/request-password-reset`; the first attempt guarded the old name, which 404s.
Both are matched now. Re-verified: 5 allowed, then `429 RESET_RATE_LIMITED`,
with sign-in unaffected.

### P6 — MEDIUM: login minted sessions for principals who could not use the app

`/staff-auth/verify-otp` and `/staff-auth/session` issued a session to anyone
with an active staff row, including roles holding no `pwa` scope (`admin` holds
only `portal` + `hr`). The global scope guard then answered 403 to every
subsequent call — a credential that opens nothing. Worse, **`/staff-auth/logout`
was itself behind that guard**, so the client could not clear the credential it
had just been handed.

This surfaced only because the H3 fix changed `SCOPE_ENFORCEMENT` from a
never-set `dryrun` default to `all`; the trap was latent before.

**Fix:** `hasTeamAppAccess` gates both session-issuing paths (checked at issuance,
not at `/login`, so it cannot be used to probe scopes before an OTP is proven);
logout paths are exempt from the scope gate via `ALWAYS_ALLOWED_PATHS`, since
logout only ever destroys the caller's own session.

### P7 — the deploy-time footgun behind all of this

`TRUSTED_IP_MODE` defaults to `enforce`, which is correct **only once a trusted
proxy is in front**. With none, every public request lacks the header and
`requireClientIp` rejects it. That ordering requirement lived solely in a code
comment, and the variable was set in no env file, no CI workflow and no service
config — the same "control that exists but never fires" pattern as the never-set
`SCOPE_ENFORCEMENT`, the dead `patient-login-limiter`, and the audit script that
was missing from the production bundle.

**Fix:** `TRUSTED_IP_MODE` / `TRUSTED_IP_HEADER` are now declared in
`config/env.ts`, and `assertTrustedIpConfigured` **refuses to boot** a staging or
production instance that has not stated one. Development is exempt (the loopback
fallback covers localhost, and a LAN address in dev should not block boot).

> **ACTION REQUIRED before the next staging or production deploy:** set
> `TRUSTED_IP_MODE` in Doppler `stg` and `prd`. Until the Cloudflare Tunnel in
> `api-edge-topology.md` is live, the correct value is `dryrun`. The backend will
> not start without it — deliberately.

### Also found

- **`kiosk.ts` had an unformatted diff** from the stage-3 edit that would have
  failed the CI lint gate. Formatted.
- `/api/auth/server-session/create` re-confirmed unreachable over HTTP: 404 with
  no `Set-Cookie` and no session row, including for trailing-slash, mixed-case
  and query-string variants.
- The kiosk swallows a failed `issueUserSession` (logs and continues), so an
  unlock can succeed without a backend session. Left as-is — the kiosk surface
  has its own auth — but it means a ban now produces a half-open kiosk state
  rather than a refusal. **Still open**, low severity.

### Gate at the end of this pass

`typecheck` 10/10 · `build` 4/4 · `test` 669 passed / 0 failed · `lint` 0 errors
· lint ratchet at baseline in all six workspaces · `db:drift` clean.

Browser-level verification was not possible: the `playwright` and
`chrome-devtools` MCP servers failed to connect this session. Everything above
was exercised over HTTP against the running backend and asserted against the
database.

---

## Medium and Low findings — fixed 2026-09-21

All of M1–M6 and L2, L4–L11. **L1 and L3 are not done** and are described at the
end with what they would actually take.

Two things surfaced while doing this that were worse than the findings that led
to them, both in the "unset variable" family:

### The `APP_ENV` defect (was filed as L7, a local-dev annoyance)

L7 said `staff-session.ts` picks cookie attributes from
`env.APP_ENV === 'development'`, `APP_ENV` is set in no Doppler config, so local
dev emitted `Secure; SameSite=None` over plain HTTP and the browser dropped the
cookie. True, and only half of it.

The same unset variable was compared in ~15 places, and the comparisons pointed
in **both directions**. `routes/staff-registration.ts` had:

```ts
const isDev = () => env.APP_ENV !== 'production'
...
...(isDev() ? { devCode: code } : {})     // the registration OTP, in the response body
```

With `APP_ENV` unset — which is the documented state of every config in this
project — `isDev()` is **true on a deployed instance**, so the staff-registration
send-otp endpoint returned the one-time code to the caller. The same variable
that broke localhost handed out OTPs in production.

Now one helper, `resolvedEnvironment()` in `config/env.ts`, resolves
`APP_ENV ?? NODE_ENV` and is used everywhere. Its three cases and why each is
what it is:

| input | result | why |
|---|---|---|
| either set to a known value | that value | explicit wins |
| both unset | `development` | a local checkout; `NODE_ENV=production` is baked into the Dockerfile and set by `render.yaml`, so a deployed instance always has one |
| set to something unrecognised | `production` | every caller uses this to decide whether to RELAX a control, so garbage must fail closed |

The middle row is not a detail. The first version of this helper returned
`production` when both were unset, on the reasoning that unknown should be
strict. That made `isDevEnvironment()` false on every developer's machine, which
silently re-broke L7 and made `sendSMS` throw `Hubtel credentials not
configured` locally. **The type checker was happy; a smoke test caught it.**

### L2 was not "compile out a dev route"

`DELETE /api/seed/clear` deletes every patient, appointment, medical record,
payment and payment plan, and it shipped in the production bundle gated only by
the admin role. Admin is an everyday operational role here, not break-glass — so
one stolen admin session, or one confused-deputy bug, was the distance between
normal operation and an unrecoverable wipe of the clinic's clinical history. The
whole router now 404s outside development.

---

### M1 — enumeration in the forgot-password flow

Step 2 had three distinguishable answers — unknown phone, known phone with no
live code, known phone with a wrong code ("4 attempts remaining") — so submitting
any code told you whether a number was real. Now one message for every failure,
at the OTP library *and* at the route. Verified against all three branches:

```
unknown phone     -> "Invalid or expired code. Request a new one if you need to."
known, no code    -> "Invalid or expired code. Request a new one if you need to."
known, wrong code -> "Invalid or expired code. Request a new one if you need to."
```

The precise reason survives as `result.reason` for the auth log; it must never
reach a response body.

**The timing half too.** The audit noted the constant message did not hide the
clock: a known number awaited a branding read and an outbound Hubtel call, an
unknown one returned after a single indexed lookup, and the comment claimed
otherwise. The SMS is now dispatched without being awaited, so both paths return
once the row is written (measured: 123 ms). The cost is that a genuine SMS
failure no longer reaches the caller — which is inherent, because an error the
caller can see *is* an oracle. Failures are logged and recorded as an auth event.

**UX note:** users no longer see an attempts-remaining countdown. The 5-attempt
cap and 10-minute expiry still apply. That is a deliberate trade, not an
oversight.

### M2 — the authentication trail

New `auth_events` table (migration `0217`) and `lib/auth-events.ts`.

Deliberately **not** `audit_logs`, for two reasons that both bite:

1. `audit_logs.userId` is `NOT NULL`. The events most worth having — a failed
   sign-in for an address that does not exist, an OTP for an unknown phone, a
   rejected ban — have no user id, so they *cannot* be stored there.
2. `audit_logs.userId` cascades on user delete, so deleting an account erases
   its security history exactly when someone has reason to erase it.
   `auth_events.userId` is `ON DELETE SET NULL`; the record outlives the
   account and `identifier` preserves who it was.

Recorded at: sign-in (success, failure, throttled), sign-out, OTP issue, OTP
verify, session issue (every flow, including the kiosk hand-off), password reset
request and completion, ban, and scope denial. Three rules, in that order of
importance: never throws, never blocks, never records secrets.

Verified — including the row `audit_logs` structurally could not hold:

```
sign_in  | success | admin@framada.app   | -        | portal
sign_in  | failure | admin@framada.app   | http_401 | portal
sign_in  | failure | nobody@nowhere.test | http_401 | portal   ← no user id exists
sign_out | success | admin@framada.app   | -        | portal
```

### M3 — reset links in logs

The reset URL embeds a valid, unexpired token. Logging it turned every log
reader, shipper, aggregator and backup into an account-takeover path whenever
`RESEND_API_KEY` was missing. Now logs that delivery failed, with the user id and
without the link.

### M4 — OTP read-modify-write

Consume is now `UPDATE … WHERE id = ? AND usedAt IS NULL RETURNING id`; zero rows
means another request already spent it. Attempts increment in SQL
(`attempts = attempts + 1`) with `WHERE attempts < MAX` so the cap is atomic too —
previously two concurrent wrong guesses both wrote the same number from the same
base, and five parallel guesses counted as one.

Applied to the staff store and both patient verifiers. Replay verified directly:

```
two concurrent requests, same correct code  ->  one 200, one 400
sessions created: 1
```

### M5 — caches do not invalidate across instances

The session cache is a module-level `Map`; its comment claimed a revoked
credential "is rejected on the very next request", which is true only of the
instance that handled the revocation. Corrected to state exactly what holds,
what the bound is (the 5 s TTL — the underlying rows are gone, so other
instances re-read the database), that the exposure is currently zero because the
backend runs as one container, and what to do before scaling.

One real fix alongside the honesty: `revokeAllSessionsForUser` now also
invalidates the user's **resolved permissions**. Only the offboarding path did
that, so a ban, a deactivation and a password reset each cleared sessions and
left the permission cache alone. `CacheManager.invalidate` writes a distributed
eviction key when Upstash is configured, so unlike the session cache this part
does propagate.

Noted, not changed: the permission cache does a Redis GET on **every cache hit**,
which is a network round trip per request to avoid a database read. That is not a
pattern to copy into the session cache, and is worth revisiting on its own.

### M6 — staff session lifecycle

`getSessionStaff` wrote `lastUsedAt` on every authenticated request —
fire-and-forget, so failures were silent — against a table nothing has issued a
row into since stage 2. Removed. `issueStaffSession` went with it: it had zero
callers and its only remaining function was to let someone mint a session
outside the revocation contract. The module is now read-only: it validates
sessions issued before the switch and clears them.

### L4 — CORS origins and the interface map

Two lists that must agree, which already drifted once: the pwa → patient/team
split moved the portal and the staff PWA to new hostnames, `ALLOWED_ORIGINS` was
updated and `ORIGIN_TO_INTERFACE` was not, so both resolved to `unknown` in
production. Nothing detected it because a missing entry has no symptom — the
request works, it is just gated against the wrong matrix.
`checkInterfaceMapCoverage()` now reports the mismatch at startup. A warning, not
a refusal: unmapped origins are legitimate (the patient app, the marketing site),
and `resolveAppScope` degrades rather than breaks.

### L5, L6, L8, L11 — small and exact

- **L5** `CacheManager`'s header said 60 s; the constant is 10 s. Header fixed.
- **L6** `readCookie` built `new RegExp('staff_session=([^;]+)')` unanchored, so
  `x_staff_session=…` matched too — anyone able to set a cookie on the domain
  could steer which value was read as the session token. Anchored on
  `(?:^|;\s*)`.
- **L8** `verifyPassword(args: any, ...extra: any[])` accepted an object *and* a
  positional `(password, hash)` form. Two conventions on the function that
  decides whether a password is correct is a hazard: transpose the operands and
  it still runs. The positional branch had no callers — both call sites pass the
  object — so it is gone and the argument is typed.
- **L11** `isAdmin` was `roleId === 'admin'` in one place and
  `roleId === 'admin' || role === 'admin'` in another. `role` is the column
  Better Auth's admin plugin writes via `/admin/set-role`; `roleId` is the FK the
  permission engine reads. The looser form meant setting someone's `role`
  through Better Auth, without ever assigning an RBAC role, made
  `/api/auth/permissions` report `isAdmin: true` for them. One `isAdminUser()`,
  on `roleId`.

### L9 — password policy

Three entry points had three rules: `staff-core` required 10, `staff-portal`
required 8, `routes/users.ts` deferred to Better Auth's default. The strictest
rule is decorative when a weaker door exists. Now one `lib/password-policy.ts`
applied at all three, plus `minPasswordLength` on the kernel so its own
`/reset-password` agrees.

Minimum 12, maximum 200 (so a large body cannot turn argon2id into a CPU
attack), a denylist of things weak at any length, and a rejection of passwords
containing the account identifier. **No character-class rules** — NIST 800-63B
advises against them; they produce `Password1!` and get written down.

Also added: a reset cannot set the password back to the current one. Without it a
reset completes "successfully" and changes nothing, which is precisely wrong when
the reason for the reset is a suspected compromise.

Not done, and why: no breach-corpus check (a k-anonymity lookup against HIBP puts
an outbound network dependency on the auth path and needs a fail-open/fail-closed
decision that belongs to whoever owns the deployment), and no full reuse history
(needs a password-history table).

### L10 — one-time codes were bare SHA-256

For a six-digit code that is not a hash: the input space is 10^6, so anyone who
could read `staff_otp_codes` / `patient_otp_codes` — a backup, a replica, a
read-only leak — recovered every live code in under a second and completed a
login or a password reset. Now HMAC-SHA256 keyed on `BETTER_AUTH_SECRET`, domain
separated per table so a digest from one cannot be replayed against the other,
with a constant-time comparison. It throws rather than falling back to a constant
key. No migration: codes expire in ten minutes.

---

## Not done

**L1 — six authorization idioms.** Middleware pair, the `lib/rbac` handler shim,
router-level `.use('/*')`, a local `requireAdmin`, a local `checkAdmin`, a local
`getStaffForUser`. Consolidating them is the right call and is the thing that
would make the *next* audit static instead of probe-driven — the original audit
produced three different wrong coverage counts before resorting to live probes.
It is also a change across ~150 route handlers with no test coverage to catch a
missed guard, and the failure mode is an endpoint silently losing its check. It
should be done deliberately, in slices, with the contract-diff CI guard in place
first — not folded into a batch of unrelated fixes.

**L3 — two parallel session systems.** This is stage 4 of
`auth-consolidation-plan.md` and is now mostly bookkeeping: nothing writes
`staff_sessions`, `issueStaffSession` is deleted, and `staff-session.ts` is
read-only. What remains is deleting the dual-source read in
`resolveUser`/`verifySession` and dropping the table once no rows survive. Left
for that plan rather than done here, because the dual-source read is what keeps
any session issued before the switch working.

## Gate

`typecheck` 10/10 · `build` 4/4 · `test` **686 passed** / 0 failed (up from 669;
17 new regression tests in `tests/unit/auth-hardening.test.ts`) · `lint` 0 errors
· lint ratchet re-baselined **1377 → 1375** (two dead imports removed) ·
`db:drift` clean.

The new tests pin the findings that are pure logic — the password policy
boundary, keyed OTP hashing and domain separation, `isAccountDisabled`'s
lapsed-ban semantics, and the interface-map drift check. The ones that need the
kernel or real concurrency (P1's success gate, M4's replay, M1's uniform
messages) are listed in that file as verified live, so the boundary is explicit
rather than accidental.
