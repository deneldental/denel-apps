/**
 * F15 — a signed-in staff user must not be able to rewrite their own RBAC role,
 * phone, staff-ID handle or any other identity column through Better Auth's
 * built-in `POST /api/auth/update-user`.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (F15).
 *
 * Real stack on purpose: the real Hono `app`, a real email+password sign-in that
 * sets a real session cookie, then real requests with that cookie, and the
 * `user` row read back from Postgres. Nothing is mocked. An earlier probe of
 * Better Auth's input parser said the field would be accepted; a parser result
 * is not proof the endpoint writes it, so this test checks the row itself.
 *
 * It COMMITS two fixture users (and removes them in afterAll), so it refuses
 * anything but a local Postgres and skips otherwise. It also needs the secrets
 * the backend itself needs, so plain `pnpm test` skips it:
 *
 *   pnpm --filter backend db:local:up && pnpm --filter backend db:local:setup
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/auth-update-user.test.ts
 */

import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '../../src/db'
import { account, user as userTable } from '../../src/db/schema'
import { hashPassword } from '../../src/lib/password'

const RAW_DB_URL = process.env.DATABASE_URL ?? ''
const IS_LOCAL = /@(localhost|127\.0\.0\.1|host\.docker\.internal)([:/]|$)/.test(RAW_DB_URL)
const HAS_SECRETS = Boolean(process.env.BETTER_AUTH_SECRET && process.env.BETTER_AUTH_URL)
const skip = !(IS_LOCAL && HAS_SECRETS)

const TAG = `f15-${Date.now()}`
const PASSWORD = 'Correct-Horse-Battery-93'
const PORTAL_ORIGIN = 'http://localhost:5173'

const STAFF = {
  id: crypto.randomUUID(),
  email: `staff-${TAG}@f15.test`,
  name: `F15 Staff ${TAG}`,
  roleId: 'receptionist',
  phone: '+233200000111',
}
const ADMIN = {
  id: crypto.randomUUID(),
  email: `admin-${TAG}@f15.test`,
  name: `F15 Admin ${TAG}`,
  roleId: 'admin',
}

type App = { request: (input: string, init?: RequestInit) => Response | Promise<Response> }
let app: App
const db = skip ? (null as never) : getDb(RAW_DB_URL)

async function createUser(u: {
  id: string
  email: string
  name: string
  roleId: string
  phone?: string
  baRole?: string
}) {
  const now = new Date()
  await db.insert(userTable).values({
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone ?? null,
    roleId: u.roleId,
    role: u.baRole ?? null,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(account).values({
    id: crypto.randomUUID(),
    accountId: u.id,
    providerId: 'credential',
    userId: u.id,
    password: await hashPassword(PASSWORD),
    createdAt: now,
    updatedAt: now,
  })
}

/** Real sign-in through the real handler; returns the `Cookie:` header to replay. */
async function signIn(email: string): Promise<string> {
  const res = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: PORTAL_ORIGIN, 'X-App-Id': 'portal' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  if (res.status !== 200) {
    throw new Error(`fixture sign-in failed: HTTP ${res.status} ${await res.text()}`)
  }
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  if (!cookie.includes('session_token')) throw new Error('sign-in returned no session cookie')
  return cookie
}

async function call(method: string, path: string, cookie: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: PORTAL_ORIGIN,
      'X-App-Id': 'portal',
      Cookie: cookie,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let json: { user?: { email?: string; roleId?: string } } | null = null
  try {
    json = await res.json()
  } catch {
    /* empty body */
  }
  return { status: res.status, json }
}

async function row(id: string) {
  const [r] = await db.select().from(userTable).where(eq(userTable.id, id))
  return r
}

describe.skipIf(skip)('F15 — update-user cannot change identity or RBAC columns', () => {
  let staffCookie = ''
  let adminCookie = ''

  beforeAll(async () => {
    // app.ts reads validated env at import time; validate first (see memory:
    // "static named import of validateBackendEnv fails" → import dynamically).
    // Vitest sets NODE_ENV=test, which the env schema rejects; the local server
    // runs as `development`, so the test does too.
    vi.stubEnv('NODE_ENV', 'development')
    const { validateBackendEnv } = await import('../../src/config/env')
    validateBackendEnv()
    app = (await import('../../src/app')).app as unknown as App

    await createUser(STAFF)
    await createUser({ ...ADMIN, baRole: 'admin' })
    staffCookie = await signIn(STAFF.email)
    adminCookie = await signIn(ADMIN.email)
  })

  // Every test starts from the same row. Without this, one successful attack
  // (which is what the unfixed code allows) would corrupt the fixture and make
  // each later test fail for a reason that is not its own.
  beforeEach(async () => {
    await db
      .update(userTable)
      .set({
        name: STAFF.name,
        email: STAFF.email,
        phone: STAFF.phone,
        roleId: STAFF.roleId,
        role: null,
        username: null,
        displayUsername: null,
        banned: false,
        emailVerified: true,
      })
      .where(eq(userTable.id, STAFF.id))
  })

  afterAll(async () => {
    await db.delete(userTable).where(inArray(userTable.id, [STAFF.id, ADMIN.id]))
    vi.unstubAllEnvs()
  })

  // ── Controls: these must pass before and after the fix. They are what stop
  // the refusals below from passing vacuously (e.g. because the cookie is bad).

  it('control: the session works and reports the RBAC role the frontends rely on', async () => {
    const { status, json } = await call('GET', '/api/auth/get-session', staffCookie)
    expect(status).toBe(200)
    expect(json?.user?.email).toBe(STAFF.email)
    // roleId must stay a RETURNED field after it is locked against input.
    expect(json?.user?.roleId).toBe('receptionist')
  })

  it('control: a user can still change their own display name', async () => {
    const { status } = await call('POST', '/api/auth/update-user', staffCookie, {
      name: `Renamed ${TAG}`,
    })
    expect(status).toBe(200)
    expect((await row(STAFF.id)).name).toBe(`Renamed ${TAG}`)
  })

  // ── The attack ────────────────────────────────────────────────────────────

  it.each([
    ['roleId', { roleId: 'admin' }],
    ['phone', { phone: '+233299999999' }],
    ['username (the staff-ID login handle)', { username: `hijack-${TAG}` }],
    ['displayUsername', { displayUsername: `hijack-${TAG}` }],
    ['role (Better Auth admin role)', { role: 'admin' }],
    ['banned', { banned: true }],
    ['emailVerified', { emailVerified: false }],
    ['email', { email: `taken-${TAG}@f15.test` }],
  ])('refuses to change %s and leaves the row untouched', async (_label, body) => {
    const before = await row(STAFF.id)
    const { status } = await call('POST', '/api/auth/update-user', staffCookie, body)
    const after = await row(STAFF.id)

    // The row is checked before the status so a failure shows the column that
    // was actually rewritten, not just a 200.
    expect(after.roleId).toBe('receptionist')
    expect(after.phone).toBe(before.phone)
    expect(after.username).toBe(before.username)
    expect(after.displayUsername).toBe(before.displayUsername)
    expect(after.role).toBe(before.role)
    expect(after.banned).toBe(before.banned)
    expect(after.emailVerified).toBe(before.emailVerified)
    expect(after.email).toBe(before.email)
    expect(status).toBeGreaterThanOrEqual(400)
    expect(status).toBeLessThan(500)
  })

  it('the roleId attempt does not buy access: /api/users stays forbidden for a receptionist', async () => {
    // The row alone proves the write; this proves what the write is FOR.
    // PermissionEngine grants everything when the stored roleId is 'admin'.
    expect((await call('GET', '/api/users', staffCookie)).status).toBe(403)
    await call('POST', '/api/auth/update-user', staffCookie, { roleId: 'admin' })
    expect((await call('GET', '/api/users', staffCookie)).status).toBe(403)
  })

  // The allowlist hook matches on the endpoint path, so every spelling that
  // still reaches update-user must hit it. `username` is the probe because only
  // the hook (not `input: false`) protects it.
  it.each([
    ['trailing slash', '/api/auth/update-user/'],
    ['double slash', '/api/auth//update-user'],
    ['upper case', '/api/auth/UPDATE-USER'],
    ['mixed case', '/api/auth/Update-User'],
    ['query string', '/api/auth/update-user?x=1'],
    ['percent-encoded letter', '/api/auth/%75pdate-user'],
    ['dot segment', '/api/auth/./update-user'],
  ])('path variant (%s) cannot evade the allowlist', async (_label, path) => {
    const { status } = await call('POST', path, staffCookie, { username: `evade-${TAG}` })
    expect((await row(STAFF.id)).username).toBeNull()
    // Either refused by the hook or simply not routed; never a successful write.
    expect(status).not.toBe(200)
  })

  it.each([
    ['form-urlencoded', 'application/x-www-form-urlencoded', `roleId=admin&username=evade-${TAG}`],
    [
      'multipart',
      'multipart/form-data; boundary=XB',
      `--XB\r\nContent-Disposition: form-data; name="roleId"\r\n\r\nadmin\r\n--XB--\r\n`,
    ],
  ])('a %s body cannot carry forbidden fields either', async (_label, contentType, raw) => {
    const res = await app.request('/api/auth/update-user', {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        Origin: PORTAL_ORIGIN,
        'X-App-Id': 'portal',
        Cookie: staffCookie,
      },
      body: raw,
    })
    const after = await row(STAFF.id)
    expect(after.roleId).toBe('receptionist')
    expect(after.username).toBeNull()
    expect(res.status).not.toBe(200)
  })

  it('a __proto__ key in the JSON body is refused, not ignored', async () => {
    const res = await app.request('/api/auth/update-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: PORTAL_ORIGIN,
        'X-App-Id': 'portal',
        Cookie: staffCookie,
      },
      body: `{"name":"Proto ${TAG}","__proto__":{"roleId":"admin"}}`,
    })
    const after = await row(STAFF.id)
    expect(after.roleId).toBe('receptionist')
    expect(after.name).toBe(STAFF.name)
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  it('refuses the whole request when a forbidden key rides along with an allowed one', async () => {
    const before = await row(STAFF.id)
    const { status } = await call('POST', '/api/auth/update-user', staffCookie, {
      name: `Sneaky ${TAG}`,
      roleId: 'admin',
    })
    const after = await row(STAFF.id)
    expect(after.roleId).toBe('receptionist')
    // No partial write: the allowed key must not have been applied either.
    expect(after.name).toBe(before.name)
    expect(status).toBeGreaterThanOrEqual(400)
  })

  // ── Other self-service endpoints that could touch identity. Better Auth ships
  // both but leaves them off.

  it('self-service delete-user is off: the account survives the request', async () => {
    // Pins the config: enabling `user.deleteUser` makes this red (verified).
    const { status } = await call('POST', '/api/auth/delete-user', staffCookie, {})
    expect(await row(STAFF.id)).toBeDefined()
    expect(status).toBeGreaterThanOrEqual(400)
  })

  it('self-service change-email cannot move the address from a bare request', async () => {
    // Off by default ("Change email is disabled"). Even if it were enabled, the
    // library refuses ("Verification email isn't enabled") until an email sender
    // is configured, and then only changes the address after a verification
    // round-trip. So this guards the outcome, not the flag, and stays green when
    // the flag alone is flipped (also verified).
    const { status } = await call('POST', '/api/auth/change-email', staffCookie, {
      newEmail: `moved-${TAG}@f15.test`,
    })
    expect((await row(STAFF.id)).email).toBe(STAFF.email)
    expect(status).toBeGreaterThanOrEqual(400)
  })

  // ── Admin plugin: confirm (audit F15 step 3) that its endpoints answer only
  // accounts whose Better Auth `role` is an admin role.

  it('control: an account with the admin role CAN reach the admin plugin', async () => {
    const { status } = await call('GET', '/api/auth/admin/list-users?limit=1', adminCookie)
    expect(status).toBe(200)
  })

  it.each([
    [
      'set-role',
      'POST',
      '/api/auth/admin/set-role',
      (id: string) => ({ userId: id, role: 'admin' }),
    ],
    [
      'set-user-password',
      'POST',
      '/api/auth/admin/set-user-password',
      (id: string) => ({ userId: id, newPassword: 'Another-Long-Pass-77' }),
    ],
    [
      'create-user',
      'POST',
      '/api/auth/admin/create-user',
      () => ({
        email: `made-${TAG}@f15.test`,
        password: 'Another-Long-Pass-77',
        name: 'Made',
        role: 'admin',
      }),
    ],
    ['impersonate-user', 'POST', '/api/auth/admin/impersonate-user', () => ({ userId: ADMIN.id })],
    ['list-users', 'GET', '/api/auth/admin/list-users?limit=1', () => undefined],
  ])('a non-admin session is refused by admin/%s', async (_name, method, path, makeBody) => {
    const { status } = await call(method, path, staffCookie, makeBody(STAFF.id))
    expect([401, 403]).toContain(status)
    // And nothing was created or changed behind the refusal.
    expect((await row(STAFF.id)).role).toBeNull()
    const made = await db
      .select()
      .from(userTable)
      .where(eq(userTable.email, `made-${TAG}@f15.test`))
    expect(made).toHaveLength(0)
  })
})
