# Auth consolidation — staff stack onto Better Auth

**Decision:** 2026-09-21. Option **B** from `auth-security-audit.md` — retire the
custom staff session/OTP stack and move the Team PWA onto Better Auth's
`phone-number` plugin. Taken now because the system is **pre-launch**: no live
staff sessions to migrate, no kiosk stations in the field. After launch this
same work forces a re-login for every staff member.

The contract added for H4 (`lib/account-sessions.ts`) is the interface this
collapses into, so that work is not wasted — it is stage 0.

---

## What the plugin actually provides

Verified against the installed version (`better-auth@1.6.2`), not the docs.

**Endpoints** (`dist/plugins/phone-number/routes.mjs`):

| Endpoint | Purpose |
|---|---|
| `POST /phone-number/send-otp` | issue an OTP to a phone number |
| `POST /phone-number/verify` | verify it — **creates a session** |
| `POST /sign-in/phone-number` | phone + *password* sign-in (not our flow) |
| `POST /phone-number/request-password-reset` | OTP-based reset request |
| `POST /phone-number/reset-password` | complete the reset |

`/phone-number/verify` calls `internalAdapter.createSession()` then
`setSessionCookie()` — a real Better Auth session, in the `session` table, with
its ban hook, its revocation endpoints, its rate limiting, and `hooks.after`
firing for the session cache. That is the whole point of the migration.

**Schema it adds** (`schema.mjs`) — two columns on `user`:

```
phoneNumber          string, UNIQUE, nullable
phoneNumberVerified  boolean, nullable
```

The passwordless staff flow becomes `send-otp` → `verify`, replacing
`staff-otp.ts` + `staff-session.ts` entirely.

---

## Blockers found — read before starting

### B1 — RESOLVED (2026-09-21): there is no production database

There is no production deployment yet, so the only data is the local dev DB:
1 user, 0 phone numbers, 0 duplicates. The audit script's verdict is
**READY**. Nothing can conflict with the uniqueness constraint.

**Re-run the check before go-live**, once real staff are onboarded — that is
when it earns its keep. It is now bundled into the production image (it was
not, see below), so:

```
docker compose run --rm backend node dist/scripts/audit-staff-phones.js
```

The original concern, kept for when that day comes:

### B1 (original) — `phoneNumber` is UNIQUE, and our data may not be

The plugin declares `unique: true`. `staff.phone` has no such constraint. If two
staff rows linked to `user` records share a phone (shared clinic handset, a
typo, a family member's number used twice), the migration **fails on the index
build**, or the backfill silently drops rows.

Run this against **production** before writing the migration — the dev DB is
seeded and proves nothing:

```sql
SELECT phone, count(*), array_agg("userId")
FROM staff
WHERE "deletedAt" IS NULL AND "userId" IS NOT NULL AND phone IS NOT NULL
GROUP BY phone HAVING count(*) > 1;
```

Non-empty result means a data decision is needed (who owns the number) before
any schema work. Also normalise format first — `0244…` and `+23324 4…` are the
same handset and must not become two rows.

### B2 — the kiosk creates a staff session server-side

`kiosk.ts:952` calls `issueStaffSession(c, targetUserId)` to hand a paired
station an operator session. Better Auth creates sessions through
`ctx.context.internalAdapter.createSession()`, which is reachable from inside a
plugin or endpoint, **not** as a plain public API call from arbitrary route
code.

This is the hard part of the migration and it sits in the kiosk, which was
explicitly excluded from the audit. Options, in preference order:

1. Have the kiosk call `/phone-number/verify` server-side with the operator's
   verified code, taking the session cookie it returns.
2. A small custom Better Auth plugin exposing an admin-only
   "create session for user" endpoint, so session creation stays inside the
   kernel where the hooks fire.
3. Keep `staff_sessions` for the kiosk alone, with `getSessionStaff` retained
   solely for that path. Least work, but leaves two mechanisms — i.e. it is not
   really option B.

Do not pick this by default. Whichever is chosen, it determines whether
`staff-session.ts` can actually be deleted.

### B3 — trusted devices have no equivalent

`staff-trusted-device.ts` lets a known device skip OTP. Better Auth's
`phone-number` plugin has no such concept (`two-factor` has "trust this device",
but that is a different flow). It stays as our own code either way; it only
needs re-keying from `staff.id` to `user.id` if the staff linkage changes.

### B4 — the Team app frontend changes

`team/` calls our custom endpoints. It moves to the Better Auth client's
phone-number methods. `team/` is outside the current portals-only scope, so
this needs its scope boundary opened deliberately.

---

## Stages

Each is independently shippable and leaves the system working.

**Stage 0 — done.** `lib/account-sessions.ts` — the contract every surface now
obeys. Already merged.

**Stage 1 — additive, zero switchover.** Enable the plugin alongside the
existing stack. Migration adds `phoneNumber` / `phoneNumberVerified`. Backfill
normalised phone numbers from `staff.phone` (after B1 is resolved). Wire the
plugin's `sendOTP` to our existing `sendSMS`. Nothing changes behaviour: the
custom flow still serves every login. Verifiable by calling `send-otp` /
`verify` directly and confirming a `session` row appears.

**Stage 2 — switch the Team PWA.** `staff-auth.ts` and the `team/` client move
to the plugin endpoints. `staff_sessions` stops being issued for normal logins.
The dual-source read in `resolveUser` stays, so any session issued before the
switch keeps working until it expires.

**Stage 3 — resolve the kiosk (B2).** Until this lands, `staff-session.ts`
cannot be deleted.

**Stage 4 — delete the custom stack.** Remove `staff-session.ts`,
`staff-otp.ts` and the dual-source branch in `resolveUser`/`verifySession`. Drop
`staff_sessions` in a later migration, once no rows are being written.

Stage 4 is where the benefit is actually banked: one session mechanism, one
revocation path, one place a ban is enforced.

---

## Pre-flight checklist

- [ ] **B1 duplicate-phone query run against production**, result empty or resolved
- [ ] Phone-number normalisation agreed (E.164 — `+233…`) and applied to the backfill
- [ ] B2 decided — which of the three kiosk options
- [ ] `team/` scope boundary opened for B4
- [ ] Confirm still pre-launch when stage 2 lands; if not, the re-login cost
      returns and the plan needs a migration window

## Status

**Stage 0 — complete.** `lib/account-sessions.ts`, the shared contract.

**Stage 1 — complete and verified (2026-09-21).**

- Migration `0218_user_phone_number_auth.sql`: adds `user.phoneNumber` and
  `user.phoneNumberVerified`, plus the unique index.
- `phoneNumber()` plugin wired in `auth.ts`, `sendOTP` → the existing `sendSMS`,
  6-digit code, 10-minute TTL (matching what the custom staff OTP used, so the
  two behave identically while both exist).
- **`signUpOnVerification` deliberately not set.** With it, verifying an OTP
  for an unknown number creates a user, which would reopen H1 by another door.

Verified end to end against the local stack:

| step | result |
|---|---|
| `POST /phone-number/send-otp` | 200, OTP row written to `verification` |
| `POST /phone-number/verify` | 200, **session row created in `session`** |
| cookie | `portal.session_token` set, HttpOnly |
| `phoneNumberVerified` | flipped to `true` |
| OTP row after verify | consumed — 0 rows, single-use |
| unknown number → verify | 500 `FAILED_TO_UPDATE_USER`, **user count unchanged** |

Nothing is switched over: `lib/staff-session.ts` still serves every real login.

*Carry into stage 2:* that unknown-number path returns a 500. It is fail-closed
and does not leak (an attacker cannot obtain the SMS'd code for a number they
do not control), but it should surface as a clean 4xx rather than an error-level
500 in the logs.

**Stage 2 — complete and verified (2026-09-21).** The Team PWA's login now
produces a Better Auth session.

The naive reading of stage 2 — point the frontend at the plugin's own
`send-otp` / `verify` endpoints — would have **regressed three things**, because
`staff-auth.ts` is not a thin wrapper. It gates on `findActiveStaffByPhone`
(the plugin's `send-otp` texts *any* number, verified — it returned 200 for a
number with no account), it checks the staff row is active rather than merely
that a user exists, and it honours trusted devices that skip OTP entirely.

So `staff-auth.ts` keeps owning the rules and only *session creation* moved.
That required the same capability B2 needs, which reordered the plan: **the
kiosk plugin had to be built first, and stages 2 and 3 now share it.**

- `lib/auth-plugins/server-session.ts` — a Better Auth plugin exposing one
  capability: create a session for a user id, inside the kernel, so the cookie
  prefix, signature, ban check and hooks all apply.
- `lib/issue-session.ts` — `issueUserSession(c, userId)`, which calls it via
  `auth.api.createServerSession({ returnHeaders: true })` and forwards the
  kernel's own `Set-Cookie` rather than rebuilding it.
- `staff-auth.ts` — both `issueStaffSession` call sites replaced; `/me`,
  `/logout` and `/forget-this-device` moved onto `getCurrentUser`, which reads
  Better Auth sessions *and* any legacy `staff_session` still in the wild.

**`team/` needed no changes.** The endpoints and payloads are identical and the
session cookie is HttpOnly either way, so the client never saw the switch. Only
its stale comments were corrected.

Verified end to end, from an empty session table:

| step | result |
|---|---|
| `POST /staff-auth/login` | 200, OTP issued |
| `POST /staff-auth/verify-otp` | 200, cookie **`staff-pwa.session_token`** (Better Auth, correct per-app prefix) |
| session rows | 0 → **1** |
| `staff_sessions` rows | **0** — no custom session issued |
| `GET /staff-auth/me` | 200 |
| `POST /staff-auth/logout` | 200, session rows → **0** |
| `GET /staff-auth/me` after logout | 401 |

### The server-session plugin's security model

Every Better Auth plugin endpoint is routed under `/api/auth/*`, so an
unguarded "create a session for this user id" endpoint would be a total
authentication bypass. Two things stop it:

1. It refuses any call where `ctx.request` is set — i.e. anything that arrived
   over HTTP. In-process `auth.api.*` calls leave it undefined.
2. Better Auth does not appear to route it at all: posting a real user id to
   `/api/auth/server-session/create` returns **404**, with no `Set-Cookie` and
   no new session row. Verified.

It also applies the same ban check as `lib/account-sessions.ts`, so a banned
account cannot be handed a session through this door.

**Stage 3 — complete and verified (2026-09-21).** The kiosk operator hand-off
now issues its session through the kernel.

It was NOT the one-line swap this plan predicted. `kiosk.ts` was not calling
`issueStaffSession` alone — it also hand-rolled a Better Auth session beside it:

```ts
await db.insert(authSessionTable).values({ id: crypto.randomUUID(), token: sessionToken, ... })
const secret = process.env.BETTER_AUTH_SECRET || 'secret'   // known-value fallback
const signedToken = await signBetterAuthCookie(sessionToken, secret)
setCookie(c, 'portal.session_token', signedToken, { ... })  // hardcoded prefix
```

That duplicated the cookie name, the secure/sameSite logic and the session TTL,
skipped the ban check entirely, and signed with a **known-value secret fallback**
— had `BETTER_AUTH_SECRET` ever been unset, every kiosk cookie would have been
forgeable by anyone who read this file. The hardcoded `portal.` prefix also meant
a kiosk on any other surface minted a cookie the app would not read.

- The whole block is now `issueUserSession(c, targetUserId)`.
- Local `signBetterAuthCookie` and the `session as authSessionTable` import: deleted.
- `/lock` used to delete the cookie by hand and leave the `session` row alive.
  It now calls Better Auth `signOut`.

`issueStaffSession` has **no callers left**; nothing writes `staff_sessions`.

**Stage 4 — not started.** Delete `staff-session.ts`, `staff-otp.ts`(*) and the
dual-source read in `resolveUser`/`verifySession`, then drop `staff_sessions` in
a later migration.

(*) `staff-otp.ts` now looks **permanent, not transitional** — see below.

---

## Correction: the phone-number plugin was removed, not adopted

Stage 1 registered Better Auth's `phoneNumber()` plugin and added
`user.phoneNumber` / `user.phoneNumberVerified` (migration `0215`). The 2026-09-21
audit found it had **never been used by any flow** — every OTP goes to
`staff_otp_codes`, and `verification` stays empty. Stage 2 had already explained
why: the plugin's own `send-otp` texts *any* number handed to it, whereas
`staff-auth.ts` must first resolve an **active, non-deleted staff record**. So
staff-auth kept the OTP and only session creation moved.

Leaving it registered was not neutral. Every plugin endpoint mounts under
`/api/auth/*`, so it published an **unauthenticated
`POST /api/auth/phone-number/send-otp` that sent an SMS to any number on earth**
at the clinic's Hubtel expense. Verified against the running stack:

| probe | result |
|---|---|
| unauthenticated POST, number with no account | **200 `{"message":"code sent"}`** |
| `verification` row written | yes |
| SMS composed | yes |
| anything capping it | **no** — Better Auth's IP limiter skips when it cannot resolve a client address |

Removed 2026-09-21: the plugin registration, its two columns (migration `0216`),
and the now-orphaned `sendSMS` / `getBranding` imports in `auth.ts`. Re-verified:
the endpoint 404s, `verification` stays empty, and staff phone+OTP login still
works end to end.

**Consequence for stage 4:** the plugin cannot serve this clinic's staff login,
so `staff-otp.ts` is not transitional code waiting to be deleted — it is the OTP
implementation, and it stays. Stage 4 shrinks to deleting `staff-session.ts`, the
dual-source read, and the `staff_sessions` table.

### Two things found while doing stage 1

1. **`audit-staff-phones.ts` was not in the production build.** The readiness
   check for this very migration existed, and `tsup.config.ts` did not list it —
   so it shipped only to environments with `src/` and `tsx`, i.e. never to
   production. Added. This is the same pattern as the dead
   `patient-login-limiter` and the never-set `SCOPE_ENFORCEMENT`: written,
   present in review, absent where it mattered.

2. **`drizzle-kit generate` cannot be used in this repo.** There are 214
   migrations and 214 journal entries but only **19 meta snapshots**, so the
   generator diffs against a snapshot from around migration 19 and prompts to
   "create or rename" tables that have existed for a hundred migrations.
   Accepting those prompts would emit a destructive migration. `0215` was
   hand-written and registered in `meta/_journal.json` manually, matching what
   the recent migrations already do. Worth fixing separately — until then, every
   migration must be hand-written and the `db:drift` check is the only guard.
