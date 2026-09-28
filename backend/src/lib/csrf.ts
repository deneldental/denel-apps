/**
 * Double-submit cookie CSRF protection.
 *
 * Strategy:
 *  - On safe methods (GET / HEAD / OPTIONS): ensure a `csrf_token` cookie is
 *    set. The cookie is NOT httpOnly so the frontend can read it.
 *  - On unsafe methods (POST / PUT / PATCH / DELETE): require an
 *    `X-CSRF-Token` header that matches the cookie. Comparison is
 *    constant-time.
 *
 * A malicious cross-origin form can submit credentials with the user's cookies
 * (because they ride along automatically), but cannot READ the cookie value
 * from the victim's deneldental.com session — so it cannot forge the matching
 * `X-CSRF-Token` header. That asymmetry is what protects state-changing
 * endpoints.
 *
 * Routes that bypass CSRF:
 *  - /api/auth/*           — Better Auth performs its own Origin check
 *  - /api/health           — public, no state change
 *  - /api/website-bookings — authenticated by API key, not session cookie
 *  - /api/xrays/public/*   — public share-token endpoints
 *  - /api/csrf             — issues the token, must be reachable without it
 *  - /api/staff/attendance/webhook — the Anviz device, authenticated by its password
 *  - /api/internal/cron/*  — called server-to-server (the "Run now" self-call,
 *                            QStash deliveries); every call must carry the cron
 *                            secret or a valid QStash signature, never a cookie
 *
 * The cookie's SameSite attribute mirrors Better Auth's logic so the same
 * deployment topology (cross-site CF Pages frontends + deneldental.com backend)
 * works without special-casing.
 */

import type { Context, MiddlewareHandler } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { COOKIE_DOMAIN, isAppDomainHost } from './same-site'

export const CSRF_COOKIE_NAME = 'csrf_token'
export const CSRF_HEADER_NAME = 'X-CSRF-Token'

/**
 * Per-app CSRF cookie names, keyed by the `X-App-Id` header every frontend
 * sends. All Denel apps hit the same backend host (api.deneldental.com), so a
 * single shared `csrf_token` cookie would be read/overwritten by whichever app
 * loaded last when several are open in the same browser. Giving each app its
 * own cookie keeps them isolated. Unknown callers fall back to the legacy name.
 * The value is a per-app double-submit nonce either way.
 */
const CSRF_COOKIE_BY_APP: Record<string, string> = {
  patient: 'csrf_patient',
  pwa: 'csrf_pwa',
  portal: 'csrf_portal',
  hr: 'csrf_hr',
  reports: 'csrf_reports',
}

export function csrfCookieName(c: Context): string {
  const appId = c.req.header('X-App-Id') ?? ''
  return CSRF_COOKIE_BY_APP[appId] ?? CSRF_COOKIE_NAME
}

const TOKEN_BYTES = 32
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

const BYPASS_PATTERNS: RegExp[] = [
  /^\/api\/health$/,
  /^\/api\/csrf$/,
  /^\/api\/auth(\/|$)/,
  /^\/api\/website-bookings(\/|$)/,
  /^\/api\/xrays\/public(\/|$)/,
  /^\/api\/staff\/attendance\/webhook(\/|$)/,
  /^\/api\/internal\/cron(\/|$)/,
]

function shouldBypass(path: string): boolean {
  return BYPASS_PATTERNS.some((re) => re.test(path))
}

function generateToken(): string {
  const buf = new Uint8Array(TOKEN_BYTES)
  crypto.getRandomValues(buf)
  let hex = ''
  for (let i = 0; i < buf.length; i++) {
    hex += buf[i].toString(16).padStart(2, '0')
  }
  return hex
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

interface CookieAttrs {
  secure: boolean
  sameSite: 'Lax' | 'None' | 'Strict'
  domain?: string
  path: string
  maxAge: number
  httpOnly: false
}

function cookieAttributes(c: Context): CookieAttrs {
  const requestHostname = (() => {
    try {
      return new URL(c.req.url).hostname
    } catch {
      return ''
    }
  })()
  const isLocalhost = requestHostname === 'localhost' || requestHostname === '127.0.0.1'
  const isHttps = !isLocalhost

  if (!isHttps) {
    return {
      secure: false,
      sameSite: 'Lax',
      path: '/',
      maxAge: COOKIE_MAX_AGE_SECONDS,
      httpOnly: false,
    }
  }

  // Match Better Auth's same-site detection: only set domain=.deneldental.com
  // when BOTH the calling frontend and this backend live under deneldental.com.
  // Otherwise the browser will silently reject the Set-Cookie. The domain and the
  // boundary check are shared with auth.ts via lib/same-site.ts so they can't drift.
  const origin = c.req.header('Origin') || c.req.header('Referer') || ''
  let originHostname = ''
  try {
    originHostname = new URL(origin).hostname
  } catch {}

  if (isAppDomainHost(originHostname) && isAppDomainHost(requestHostname)) {
    return {
      secure: true,
      sameSite: 'Lax',
      domain: COOKIE_DOMAIN,
      path: '/',
      maxAge: COOKIE_MAX_AGE_SECONDS,
      httpOnly: false,
    }
  }

  return {
    secure: true,
    sameSite: 'None',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
    httpOnly: false,
  }
}

export function ensureCsrfCookie(c: Context): string {
  const cookieName = csrfCookieName(c)
  const existing = getCookie(c, cookieName)
  if (existing) return existing

  const token = generateToken()
  const attrs = cookieAttributes(c)
  setCookie(c, cookieName, token, attrs)
  return token
}

export function csrfMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const path = c.req.path
    if (shouldBypass(path)) return next()

    const method = c.req.method.toUpperCase()

    if (SAFE_METHODS.has(method)) {
      ensureCsrfCookie(c)
      return next()
    }

    const cookieToken = getCookie(c, csrfCookieName(c))
    const headerToken = c.req.header(CSRF_HEADER_NAME)

    if (!cookieToken || !headerToken || !timingSafeEqual(cookieToken, headerToken)) {
      return c.json({ error: 'CSRF token mismatch' }, 403)
    }

    return next()
  }
}
