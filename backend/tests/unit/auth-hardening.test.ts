/**
 * Regression tests for the authentication audit fixes.
 *
 * Every case here corresponds to a finding in
 * `project-docs/auth-security-audit.md` that was fixed and then verified by
 * hand against a running backend. Hand-verification does not survive a
 * refactor, which is the gap these close: each test names its finding, and a
 * failure means that specific defect has come back.
 *
 * Scoped to the pure logic. The parts that need a database or the Better Auth
 * kernel (the ban hook's success gate, OTP atomicity under concurrency, the
 * scope gate) are exercised in the integration suite and by the documented
 * manual probes — they are noted at the bottom so the boundary is explicit
 * rather than accidental.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isAccountDisabled } from '../../src/lib/account-sessions'
import { redactSecrets } from '../../src/lib/audit'
import { readAuthIdentifier } from '../../src/lib/auth-identifier'
import { hashOtp, timingSafeEqualHex } from '../../src/lib/otp-hash'
import {
  checkPasswordPolicy,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from '../../src/lib/password-policy'
import { sharesSiteWithBackend } from '../../src/lib/same-site'
import { checkInterfaceMapCoverage } from '../../src/rbac/middleware/detectInterface'

describe('L9 — one password policy at every entry point', () => {
  it('rejects anything shorter than the shared minimum', () => {
    // staff-portal required 8 and staff-core required 10; both are now this.
    const oneShort = `a!${'b'.repeat(MIN_PASSWORD_LENGTH - 3)}`
    expect(oneShort).toHaveLength(MIN_PASSWORD_LENGTH - 1)
    expect(checkPasswordPolicy(oneShort).ok).toBe(false)
    // …and the same string one character longer is accepted, so the test is
    // pinning the boundary rather than just "short things fail".
    expect(checkPasswordPolicy(`${oneShort}c`).ok).toBe(true)
    expect(checkPasswordPolicy('short').ok).toBe(false)
  })

  it('accepts a long passphrase with no symbols or digits', () => {
    // NIST 800-63B: length, not composition. A rule that forces `Password1!`
    // over `correct horse battery staple` makes things worse.
    expect(checkPasswordPolicy('correct horse battery staple').ok).toBe(true)
  })

  it('caps length so hashing cannot be turned into a CPU attack', () => {
    expect(checkPasswordPolicy('a1! '.repeat(200)).ok).toBe(false)
    expect(checkPasswordPolicy('x'.repeat(MAX_PASSWORD_LENGTH + 1)).ok).toBe(false)
  })

  it('rejects guessable content regardless of length', () => {
    expect(checkPasswordPolicy('denelclinic2026password').ok).toBe(false)
    expect(checkPasswordPolicy('framadadental123456').ok).toBe(false)
    expect(checkPasswordPolicy('aaaaaaaaaaaaaaaa').ok).toBe(false)
    expect(checkPasswordPolicy('1234567890123456').ok).toBe(false)
  })

  it('rejects a password containing the account identifier', () => {
    // Guessable by anyone who knows whose account it is — for staff, everyone.
    expect(checkPasswordPolicy('melarc-is-my-password', 'melarc@denel.test').ok).toBe(false)
    // A short local-part must not make every password fail.
    expect(checkPasswordPolicy('unrelated passphrase here', 'ab@denel.test').ok).toBe(true)
  })

  it('requires a password at all', () => {
    expect(checkPasswordPolicy('').ok).toBe(false)
  })
})

describe('L10 — one-time codes are keyed, not bare SHA-256', () => {
  beforeEach(() => {
    vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-that-is-at-least-32-chars-long')
  })

  it('does not produce SHA-256(code)', async () => {
    // The whole finding: a 6-digit space is exhaustible instantly, so an
    // unkeyed digest is not a hash — anyone who can read the table recovers
    // every live code.
    const { createHash } = await import('node:crypto')
    const bare = createHash('sha256').update('123456').digest('hex')
    expect(await hashOtp('123456', 'staff')).not.toBe(bare)
  })

  it('is stable for the same input', async () => {
    expect(await hashOtp('123456', 'staff')).toBe(await hashOtp('123456', 'staff'))
  })

  it('separates the staff and patient domains', async () => {
    // A digest captured from one table must not verify against the other.
    expect(await hashOtp('123456', 'staff')).not.toBe(await hashOtp('123456', 'patient'))
  })

  it('refuses to hash without a key rather than falling back to a constant', async () => {
    // The key is imported once and cached for the life of the process, so this
    // needs a fresh module instance — stubbing the env after another test has
    // already hashed something would assert nothing.
    vi.resetModules()
    vi.stubEnv('BETTER_AUTH_SECRET', '')
    const fresh = await import('../../src/lib/otp-hash')
    await expect(fresh.hashOtp('123456', 'staff')).rejects.toThrow(/BETTER_AUTH_SECRET/)
  })
})

describe('timingSafeEqualHex', () => {
  it('compares correctly', () => {
    expect(timingSafeEqualHex('abcd', 'abcd')).toBe(true)
    expect(timingSafeEqualHex('abcd', 'abce')).toBe(false)
    expect(timingSafeEqualHex('abcd', 'abcde')).toBe(false)
    expect(timingSafeEqualHex('', '')).toBe(true)
  })
})

describe('H5 / P2 — isAccountDisabled is the one account-status rule', () => {
  it('treats an unbanned account as enabled', () => {
    expect(isAccountDisabled({ banned: false })).toBe(false)
    expect(isAccountDisabled({})).toBe(false)
    expect(isAccountDisabled({ banned: null })).toBe(false)
  })

  it('treats a live ban as disabled', () => {
    expect(isAccountDisabled({ banned: true })).toBe(true)
    expect(isAccountDisabled({ banned: true, banExpires: new Date(Date.now() + 60_000) })).toBe(
      true
    )
  })

  it('treats a lapsed ban as enabled, matching the admin plugin', () => {
    // Mirrors better-auth's own semantics. One stack accepting a credential the
    // other rejects is the bug class this function exists to close.
    expect(isAccountDisabled({ banned: true, banExpires: new Date(Date.now() - 60_000) })).toBe(
      false
    )
  })
})

describe('L4 — CORS origins and the interface map must agree', () => {
  it('reports an allowed origin that has no interface mapping', () => {
    // The pwa → patient/team split moved the portal and staff PWA to new
    // hostnames; ALLOWED_ORIGINS was updated and the map was not, so both
    // resolved to "unknown" in production with no symptom.
    expect(checkInterfaceMapCoverage(['https://brand-new-app.example.com'])).toEqual([
      'https://brand-new-app.example.com',
    ])
  })

  it('stays quiet for mapped origins', () => {
    expect(
      checkInterfaceMapCoverage(['https://portal.deneldental.com', 'http://localhost:5173'])
    ).toEqual([])
  })

  it('stays quiet for deliberately unmapped origins and wildcards', () => {
    // The apex (marketing), app. (patient) and reports. are authorised by other
    // means; the substring entry covers every deneldental.com origin the map
    // does not name.
    expect(
      checkInterfaceMapCoverage(['https://deneldental.com', '*.portal-22g.pages.dev', '  '])
    ).toEqual([])
    expect(checkInterfaceMapCoverage(['https://app.deneldental.com'])).toEqual([])
  })
})

describe('session cookie same-site detection (single deneldental.com domain)', () => {
  // The whole app suite now lives under one registrable domain, so a browser on
  // any app sends its session cookie to api.deneldental.com as a same-site
  // request → SameSite=Lax + a .deneldental.com parent-domain cookie. Anything
  // NOT on that domain (staging on *.pages.dev, a Render backend) must fall to
  // SameSite=None or the cookie never flows. Getting this wrong silently breaks
  // sign-in on deploy, which is why it is pinned here.
  it('treats a deneldental.com app with the deneldental.com API as same-site', () => {
    expect(
      sharesSiteWithBackend('https://portal.deneldental.com', 'https://api.deneldental.com', true)
    ).toBe(true)
    expect(
      sharesSiteWithBackend('https://app.deneldental.com', 'https://api.deneldental.com', true)
    ).toBe(true)
  })

  it('is cross-site when the frontend is a pages.dev preview', () => {
    expect(
      sharesSiteWithBackend('https://staging.portal.pages.dev', 'https://api.deneldental.com', true)
    ).toBe(false)
  })

  it('is cross-site when the backend is a Render staging URL', () => {
    expect(
      sharesSiteWithBackend('https://portal.deneldental.com', 'https://denel-api.onrender.com', true)
    ).toBe(false)
  })

  it('is never same-site over http, so local dev is unaffected', () => {
    expect(sharesSiteWithBackend('http://localhost:5173', 'http://localhost:3000', false)).toBe(
      false
    )
  })

  it('does not treat a lookalike domain as same-site', () => {
    // The check is on the registrable-domain boundary, not a bare substring:
    // neither a suffix collision nor a subdomain trick counts.
    expect(
      sharesSiteWithBackend('https://notdeneldental.com', 'https://api.deneldental.com', true)
    ).toBe(false)
    expect(
      sharesSiteWithBackend(
        'https://portal.deneldental.com.evil.test',
        'https://api.deneldental.com',
        true
      )
    ).toBe(false)
  })
})

describe('post-remediation: the throttle must see what the kernel sees', () => {
  const form = (body: string, contentType: string) =>
    new Request('http://x/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    })

  it('reads the identifier from a JSON body', async () => {
    const req = form(JSON.stringify({ email: 'a@b.test', password: 'x' }), 'application/json')
    expect(await readAuthIdentifier(req)).toEqual({ kind: 'found', identifier: 'a@b.test' })
  })

  it('reads the identifier from a form-encoded body', async () => {
    // THE BYPASS. Better Auth's /sign-in/email declares
    // allowedMediaTypes: ["application/x-www-form-urlencoded", "application/json"],
    // so this body authenticates normally — but `request.json()` throws on it,
    // which left `identifier` null and skipped the throttle, the failure
    // counter and the auth-event record entirely.
    const req = form('email=a%40b.test&password=guess', 'application/x-www-form-urlencoded')
    expect(await readAuthIdentifier(req)).toEqual({ kind: 'found', identifier: 'a@b.test' })
  })

  it('reads the identifier from a multipart body', async () => {
    const fd = new FormData()
    fd.set('email', 'a@b.test')
    fd.set('password', 'guess')
    const req = new Request('http://x/api/auth/sign-in/email', { method: 'POST', body: fd })
    expect(await readAuthIdentifier(req)).toEqual({ kind: 'found', identifier: 'a@b.test' })
  })

  it('reports a parsed body with no identifier as absent, not found', async () => {
    const req = form(JSON.stringify({ password: 'x' }), 'application/json')
    expect(await readAuthIdentifier(req)).toEqual({ kind: 'absent' })
  })

  it('reports an unreadable body as unparseable so the caller can fail closed', async () => {
    const req = form('not json at all', 'application/json')
    expect(await readAuthIdentifier(req)).toEqual({ kind: 'unparseable' })
  })

  it('leaves the original body readable for the kernel', async () => {
    const req = form(JSON.stringify({ email: 'a@b.test' }), 'application/json')
    await readAuthIdentifier(req)
    await expect(req.json()).resolves.toEqual({ email: 'a@b.test' })
  })
})

describe('audit_logs must never hold a credential', () => {
  it('redacts password-like keys but keeps the surrounding record', () => {
    // routes/users.ts passed the raw request body as `changes` on user-create
    // and admin-password-set, so the CLEARTEXT password of every portal-created
    // account was persisted to a table /api/audit-logs serves.
    expect(redactSecrets({ email: 'a@b.test', password: 'hunter2', roleId: 'doctor' })).toEqual({
      email: 'a@b.test',
      password: '[redacted]',
      roleId: 'doctor',
    })
  })

  it('redacts nested and aliased secrets', () => {
    expect(
      redactSecrets({
        user: { newPassword: 'x', confirmPassword: 'x' },
        apiKey: 'k',
        items: [{ secret: 's' }],
        name: 'keep me',
      })
    ).toEqual({
      user: { newPassword: '[redacted]', confirmPassword: '[redacted]' },
      apiKey: '[redacted]',
      items: [{ secret: '[redacted]' }],
      name: 'keep me',
    })
  })

  it('leaves records with no secrets untouched', () => {
    const clean = { amount: 100, note: 'passed review' }
    expect(redactSecrets(clean)).toEqual(clean)
  })
})

/**
 * Covered elsewhere, deliberately:
 *
 *  - P1 (the ban hook firing on rejected calls) needs the Better Auth kernel to
 *    produce a real `APIError` in `context.returned`; asserting on a hand-built
 *    stub would test the stub. Verified against a running backend: an
 *    unauthenticated POST to /admin/ban-user returns 401 and leaves the
 *    victim's session intact.
 *  - M4 (OTP replay) is a concurrency property — two simultaneous requests with
 *    the same correct code must yield exactly one session. Verified live.
 *  - M1's uniform failure message spans route handlers and the OTP library;
 *    verified live across all three branches of the forgot-password flow.
 *  - `resolvedEnvironment()` reads process.env at call time and is asserted by
 *    the dev-behaviour smoke checks; a unit test would mostly restate the
 *    implementation.
 *  - The portal reset revoking every session needs the kernel to run
 *    `onPasswordReset`; the hook body is a single call into
 *    `revokeAllSessionsForUser`, which the offboarding integration test
 *    already covers.
 *  - The PermissionEngine admin bypass on `roleId` alone needs a database —
 *    asserted by the RBAC matrix suite.
 */
