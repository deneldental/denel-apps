/**
 * Real-session helpers for integration tests that drive the whole backend:
 * the real Hono `app`, real users in Postgres, a real `/api/auth/sign-in/email`
 * and the real session cookie it sets. Nothing is mocked, so a test written with
 * these proves what an actual signed-in role can and cannot do.
 *
 * These tests COMMIT users. Use only with a local Postgres (see `isLocalDb`) and
 * delete what you create in `afterAll` (see `deleteLoginUsers`).
 */
import { eq } from 'drizzle-orm'
import { type DB, getDb } from '../../src/db'
import { account, session, user as userTable } from '../../src/db/schema'
import { hashPassword } from '../../src/lib/password'

export const TEST_PASSWORD = 'Correct-Horse-Battery-93'

/** `Origin` + `X-App-Id` pairs the backend maps to each frontend (detectInterface). */
export const INTERFACES = {
  portal: { origin: 'http://localhost:5173', appId: 'portal' },
  pwa: { origin: 'http://localhost:5175', appId: 'pwa' },
  hr: { origin: 'http://localhost:5176', appId: 'hr' },
} as const
export type Interface = keyof typeof INTERFACES

export type TestApp = {
  request: (input: string, init?: RequestInit) => Response | Promise<Response>
}

export const RAW_DB_URL = process.env.DATABASE_URL ?? ''

/** True only for a database on this machine: these suites commit rows. */
export const isLocalDb = /@(localhost|127\.0\.0\.1|host\.docker\.internal)([:/]|$)/.test(RAW_DB_URL)

/** True when the backend's own secrets are present (run via `scripts/dev-local.mjs`). */
export const hasBackendSecrets = Boolean(
  process.env.BETTER_AUTH_SECRET && process.env.BETTER_AUTH_URL
)

export interface LoginUserInput {
  id?: string
  email: string
  name: string
  roleId: string
  phone?: string
  /** Better Auth admin-plugin role; leave unset for everyone but a test admin. */
  baRole?: string
}

/** Creates a user and a credential account the real sign-in will accept. */
export async function createLoginUser(db: DB, input: LoginUserInput): Promise<string> {
  const id = input.id ?? crypto.randomUUID()
  const now = new Date()
  await db.insert(userTable).values({
    id,
    name: input.name,
    email: input.email,
    phone: input.phone ?? null,
    roleId: input.roleId,
    role: input.baRole ?? null,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(account).values({
    id: crypto.randomUUID(),
    accountId: id,
    providerId: 'credential',
    userId: id,
    password: await hashPassword(TEST_PASSWORD),
    createdAt: now,
    updatedAt: now,
  })
  return id
}

/**
 * Removes fixture users (sessions and credential accounts cascade).
 *
 * A user who authored a ledger entry cannot be deleted (journal entries are
 * immutable and keep their creator). If a test drove something that books to the
 * ledger, that user is kept but locked: every way to sign in is removed and the
 * account is banned, so no usable test login is left in the database.
 */
export async function deleteLoginUsers(db: DB, ids: string[]): Promise<void> {
  for (const id of ids) {
    try {
      await db.delete(userTable).where(eq(userTable.id, id))
    } catch {
      await db.delete(account).where(eq(account.userId, id))
      await db.delete(session).where(eq(session.userId, id))
      await db
        .update(userTable)
        .set({ banned: true, banReason: 'test fixture (authored a ledger entry)' })
        .where(eq(userTable.id, id))
    }
  }
}

let signInCount = 0

/**
 * Real sign-in as `email` from the given frontend; returns the `Cookie:` header to replay.
 *
 * Better Auth caps /sign-in/email at 5 per minute per client address. Each
 * fixture presents its own address (through the trusted proxy header, as a
 * different user on a different machine would) so a suite with many roles does
 * not trip the limiter that protects real sign-ins.
 */
export async function signInAs(app: TestApp, email: string, iface: Interface): Promise<string> {
  const { origin, appId } = INTERFACES[iface]
  const ipHeader = (process.env.TRUSTED_IP_HEADER ?? 'cf-connecting-ip').toLowerCase()
  const res = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      'X-App-Id': appId,
      [ipHeader]: `10.20.${Math.floor(signInCount / 250)}.${(signInCount++ % 250) + 1}`,
    },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  })
  if (res.status !== 200) {
    throw new Error(
      `sign-in as ${email} from ${iface} failed: HTTP ${res.status} ${await res.text()}`
    )
  }
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  if (!cookie.includes('session_token'))
    throw new Error(`sign-in as ${email} set no session cookie`)
  return cookie
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * One authenticated request as a signed-in role. Returns the status and parsed JSON (or null).
 *
 * Mutating requests carry a double-submit CSRF pair (cookie `csrf_<app>` plus the
 * `X-CSRF-Token` header, which the middleware only compares for equality), exactly
 * as a frontend sends them. Without it every POST/PATCH/DELETE is answered 403
 * by the CSRF layer before the route runs — so a "refused" result would prove
 * nothing about permissions.
 */
export async function callAs(
  app: TestApp,
  iface: Interface,
  cookie: string,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const { origin, appId } = INTERFACES[iface]
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Origin: origin,
    'X-App-Id': appId,
    Cookie: cookie,
  }
  if (!SAFE_METHODS.has(method.toUpperCase())) {
    const token = crypto.randomUUID()
    headers.Cookie = `${cookie}; csrf_${appId}=${token}`
    headers['X-CSRF-Token'] = token
  }
  const res = await app.request(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let json: Record<string, unknown> | null = null
  try {
    json = await res.json()
  } catch {
    /* empty body */
  }
  return { status: res.status, json }
}

/** A database handle for the local Postgres, or `null` when the suite must skip. */
export function localDb(): DB | null {
  return isLocalDb ? getDb(RAW_DB_URL) : null
}
