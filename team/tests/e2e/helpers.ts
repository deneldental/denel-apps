import { existsSync, readFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'
import { Pool } from 'pg'

/**
 * Team E2E helpers.
 *
 * The Team app is **passwordless**: sign-in is phone number -> 6-digit SMS code
 * (`POST /api/staff-auth/login` then `/verify-otp`). There is no staffId field
 * and no password field — the pre-T27 helpers in this file drove a login form
 * that no longer exists.
 *
 * Prerequisites for anything that signs in:
 *   - backend on :3000 with `SMS_STUB_FILE` set (OTPs land in that file),
 *   - `DATABASE_URL` pointing at the same DB the backend uses,
 *   - the two seeds run (`seed-test-logins.ts`, then `seed-test-pwa-staff.ts`),
 *   - `global-setup.ts` has given each FDM-T* staff row its own phone.
 */

/** Where the SMS stub writes captured OTP messages. */
const OTP_STUB_FILE = process.env.SMS_STUB_FILE ?? 'F:/tmp/pwa-otp-stub.ndjson'

/** Backend origin, for direct API assertions inside a page context. */
export const API_URL = process.env.PLAYWRIGHT_API_URL ?? 'http://localhost:3000'

/**
 * The seeded test staff. `phone` is what `global-setup.ts` assigns (the seed
 * script itself writes the same number to all five, which always resolves to
 * the admin — a role with no `pwa` scope — so it can never sign in here).
 *
 * `teamScope` records whether the role holds the `pwa` interface scope, i.e.
 * whether `RequireTeamAccess` lets it into the app at all.
 */
export const STAFF = {
  admin: { staffId: 'FDM-T0001', phone: '+233000000001', teamScope: false, home: null },
  doctor: { staffId: 'FDM-T0002', phone: '+233000000002', teamScope: false, home: null },
  receptionist: {
    staffId: 'FDM-T0003',
    phone: '+233000000003',
    teamScope: true,
    home: '/dashboard',
  },
  trainer: { staffId: 'FDM-T0004', phone: '+233000000004', teamScope: false, home: null },
  labtech: { staffId: 'FDM-T0005', phone: '+233000000005', teamScope: true, home: '/lab/home' },
} as const

export type StaffRoleKey = keyof typeof STAFF

export const PATIENT = { patientId: '#P-TEST', phone: '0200000000' }

function isLocalDb(url: string): boolean {
  return /@(localhost|127\.0\.0\.1|host\.docker\.internal)([:/]|$)/.test(url)
}

/** A pg pool for the test DB, or null when DATABASE_URL is unusable/unsafe. */
function testPool(): Pool | null {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) return null
  const local = isLocalDb(dbUrl)
  if (!local && !/neon\.tech/.test(dbUrl)) return null
  const cleanUrl = dbUrl.replace(/([?&])sslmode=[^&]*/g, '$1').replace(/[?&]$/, '')
  return new Pool({
    connectionString: cleanUrl,
    ssl: local ? false : { rejectUnauthorized: false },
  })
}

/**
 * Clear the OTP rate-limit rows for one test staffId. The backend caps OTP
 * sends at 3 per 15 min per staff member, and a full run signs in several
 * times, so without this the later specs get rate-limited rather than tested.
 */
export async function clearStaffOtpRows(staffId: string): Promise<void> {
  const pool = testPool()
  if (!pool) return
  try {
    await pool.query(
      `DELETE FROM staff_otp_codes WHERE "staffId" IN (SELECT id FROM staff WHERE "staffId" = $1)`,
      [staffId]
    )
  } finally {
    await pool.end()
  }
}

/** True when a real, writable (local) test DB is configured. */
export function hasTestDb(): boolean {
  const dbUrl = process.env.DATABASE_URL
  return !!dbUrl && isLocalDb(dbUrl)
}

/** Run a query against the test DB. Throws if no safe DB is configured. */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const pool = testPool()
  if (!pool) throw new Error('No usable DATABASE_URL for the Team E2E suite')
  try {
    const res = await pool.query(sql, params)
    return res.rows as T[]
  } finally {
    await pool.end()
  }
}

/**
 * Read the most-recent OTP captured in the SMS stub file, written after
 * `afterIsoTime`. Polls because the SMS is appended asynchronously after the
 * login response returns.
 *
 * The message reads "...your staff portal login code is 123456. Valid...". The
 * `\b\d{6}\b` match deliberately cannot hit the 12-digit phone number that the
 * dev-redirect prefix puts in the same string.
 */
export async function readLatestOtp(afterIsoTime: string): Promise<string> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (existsSync(OTP_STUB_FILE)) {
      const lines = readFileSync(OTP_STUB_FILE, 'utf8').trim().split('\n').filter(Boolean)
      for (let i = lines.length - 1; i >= 0; i--) {
        const entry = JSON.parse(lines[i]) as { ts: string; message: string }
        if (entry.ts < afterIsoTime) continue
        const match = entry.message.match(/\b(\d{6})\b/)
        if (match) return match[1]
      }
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(
    `No OTP captured in ${OTP_STUB_FILE} after ${afterIsoTime}. Is the backend running with SMS_STUB_FILE set?`
  )
}

/**
 * Sign in a staff member with phone + OTP and wait for the post-login landing
 * page. Only roles holding the `pwa` scope can complete this — the others are
 * stopped by `RequireTeamAccess` (use `startLoginOnly` for those).
 */
export async function signInAsStaff(page: Page, role: StaffRoleKey): Promise<void> {
  const who = STAFF[role]
  await clearStaffOtpRows(who.staffId)
  const cutoff = new Date().toISOString()

  await page.goto('/login')
  const phoneField = page.getByLabel(/phone number/i)
  await phoneField.waitFor({ state: 'visible', timeout: 20_000 })
  await phoneField.fill(who.phone)
  await page.getByRole('button', { name: /continue/i }).click()

  // Untrusted device (global-setup clears trusted_devices) -> the OTP step.
  const otpInput = page.locator('input[data-input-otp="true"]').first()
  await otpInput.waitFor({ state: 'attached', timeout: 20_000 })

  const code = await readLatestOtp(cutoff)
  // The OTP block is one hidden input behind six slots; filling it fires
  // onChange, and the form auto-submits on the sixth digit.
  await otpInput.fill(code)

  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 })
}

/** Drive only step 1 (phone -> OTP prompt) — used by the no-scope role tests. */
export async function startLoginOnly(page: Page, role: StaffRoleKey): Promise<void> {
  await clearStaffOtpRows(STAFF[role].staffId)
  await page.goto('/login')
  const phoneField = page.getByLabel(/phone number/i)
  await phoneField.waitFor({ state: 'visible', timeout: 20_000 })
  await phoneField.fill(STAFF[role].phone)
  await page.getByRole('button', { name: /continue/i }).click()
}

/**
 * Clear every cookie + web storage. Does NOT navigate — the next signIn helper
 * does a single `goto('/login')`, and a double navigation races React's mount.
 */
export async function signOut(page: Page): Promise<void> {
  await page.context().clearCookies()
  try {
    await page.evaluate(() => {
      try {
        localStorage.clear()
        sessionStorage.clear()
      } catch {
        /* ignore */
      }
    })
  } catch {
    /* page not at a real URL yet */
  }
}

/**
 * Hide the `csrf_pwa` cookie from `document.cookie` for the whole page.
 *
 * This simulates the CROSS-SITE deployment (a CF Pages frontend against a
 * different backend host): `cookieAttributes()` in `backend/src/lib/csrf.ts`
 * then takes the `SameSite=None`, no-`domain` branch, so the cookie is scoped
 * to the BACKEND host and JavaScript on the frontend origin cannot read it —
 * while the browser still attaches it to `credentials: 'include'` requests.
 * Masking the getter reproduces exactly that asymmetry, which localhost cannot
 * otherwise produce (cookies there are port-agnostic and same-host).
 *
 * Must be installed before any navigation.
 */
export async function hideCsrfCookieFromJs(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')
    if (!desc?.get || !desc.set) return
    const realGet = desc.get
    const realSet = desc.set
    Object.defineProperty(Document.prototype, 'cookie', {
      configurable: true,
      get(this: Document) {
        return String(realGet.call(this))
          .split('; ')
          .filter((pair) => !pair.startsWith('csrf_pwa='))
          .join('; ')
      },
      set(this: Document, value: string) {
        realSet.call(this, value)
      },
    })
  })
}

/** Asserts an element with `text` is visible somewhere on the page. */
export async function expectVisible(page: Page, text: string | RegExp): Promise<void> {
  await expect(page.getByText(text).first()).toBeVisible()
}

// ── Deprecated shims ─────────────────────────────────────────────────────────
// The Team app dropped password sign-in (it is phone + OTP now) and the patient
// tree moved to the separate `patient/` app. These exist only so the not-yet-
// migrated specs in this directory still typecheck; calling either throws.

/** @deprecated Team sign-in is passwordless. */
export const TEST_PASSWORD = 'TestPass1234'

/** @deprecated The patient surface lives in the `patient/` app now. */
export async function signInAsPatient(_page: Page): Promise<never> {
  throw new Error(
    'signInAsPatient() is gone from the Team app — the patient surface moved to patient/. ' +
      'See project-docs/pwa-split-patient-team-build-plan.md.'
  )
}
