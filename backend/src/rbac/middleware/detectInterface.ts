/**
 * detectInterface — Hono middleware
 *
 * Determines which application interface the request is coming from
 * (portal vs pwa) by reading the request's Origin header.
 *
 * Origin-based detection is used because it is server-controlled and
 * cannot be spoofed by client JavaScript (unlike custom headers such as
 * x-interface which a client could set to any value).
 *
 * Attaches `c.var.interface` as 'portal' | 'pwa' | 'hr'.
 *
 * Deliberately NOT mapped (they resolve to 'unknown', which enforceInterfaceScope
 * leaves ungated):
 *   app.deneldental.com     — patient app; authorised by ownership, not scope
 *   deneldental.com         — marketing site; unauthenticated
 *   reports.deneldental.com — reports; read-only, has no interface scope yet
 *
 * Local dev ports come from each app's vite.config.ts:
 *   5173 → portal    (Vite default; portals sets no explicit port)
 *   5175 → pwa/team
 *   5176 → hr
 *   5177 → patient   (unmapped by design)
 */

import type { Context, MiddlewareHandler } from 'hono'
import type { HonoEnv } from '../../lib/types'
import type { AppScope } from '../engine/BundleResolver'

export type AppInterface = 'portal' | 'pwa' | 'hr' | 'unknown'

declare module 'hono' {
  interface ContextVariableMap {
    interface: AppInterface
  }
}

const ORIGIN_TO_INTERFACE: Record<string, AppInterface> = {
  // Production — every app is a subdomain of deneldental.com. Only the scoped
  // staff surfaces resolve to an interface here; the patient app
  // (app.deneldental.com) and the marketing apex are deliberately unmapped below.
  'https://portal.deneldental.com': 'portal',
  'https://team.deneldental.com': 'pwa',
  'https://hr.deneldental.com': 'hr',
  // Staging — CF Pages preview aliases (frontends on *.pages.dev, backend on Render)
  'https://staging.portal.pages.dev': 'portal',
  'https://staging.team.pages.dev': 'pwa',
  'https://staging.hr.pages.dev': 'hr',
  // Local dev
  'http://localhost:5173': 'portal',
  'http://localhost:5175': 'pwa',
  'http://localhost:5176': 'hr',
  'http://localhost:3000': 'portal',
}

/**
 * Deliberately unmapped origins — see the module header. Listed explicitly so
 * the drift check below can tell "intentionally not an app interface" from
 * "someone added an origin and forgot this file" (L4).
 */
const INTENTIONALLY_UNMAPPED = [
  // One substring entry covers every deneldental.com origin the map does not
  // name: the apex (marketing, unauthenticated), app. (patient, authorised by
  // ownership) and reports. (read-only, no interface scope yet). Mapped app
  // origins (portal./team./hr.) are filtered out before this list is consulted.
  'deneldental.com',
  'localhost:5177',
]

/**
 * L4 — report origins that CORS accepts but this map does not recognise.
 *
 * `ALLOWED_ORIGINS` and `ORIGIN_TO_INTERFACE` are two lists that have to agree,
 * and they already drifted once: the pwa → patient/team split moved the portal
 * and the staff PWA to new hostnames, `ALLOWED_ORIGINS` was updated and this
 * file was not, so both resolved to 'unknown' in production and interface-scope
 * detection was silently off for them for as long as that lasted.
 *
 * Nothing detected it because a missing entry has no symptom — the request
 * still works, it is just gated against the wrong matrix. This makes the
 * mismatch say so at startup instead.
 *
 * A warning rather than a refusal: unmapped origins are legitimate (the patient
 * app and the marketing site are authorised by other means), and
 * `resolveAppScope` falls back to the app's own `X-App-Id` before defaulting to
 * portal, so a gap degrades rather than breaks.
 */
export function checkInterfaceMapCoverage(allowedOrigins: string[]): string[] {
  const unmapped = allowedOrigins
    .map((o) => o.trim())
    .filter(Boolean)
    .filter((o) => !o.startsWith('*.'))
    .filter((o) => !ORIGIN_TO_INTERFACE[o])
    .filter((o) => !INTENTIONALLY_UNMAPPED.some((known) => o.includes(known)))
  return unmapped
}

export function detectInterface(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const origin = c.req.header('Origin') ?? ''
    const iface: AppInterface = ORIGIN_TO_INTERFACE[origin] ?? 'unknown'
    c.set('interface', iface)
    await next()
  }
}

/**
 * Standalone helper — derive interface from origin string without middleware.
 * Useful inside route handlers or services.
 */
export function deriveInterface(origin: string): AppInterface {
  return ORIGIN_TO_INTERFACE[origin] ?? 'unknown'
}

/**
 * The single place that decides which permission matrix a request resolves
 * against. Both the route shim (`lib/rbac.checkPermission`) and the middleware
 * factory (`rbac/middleware/checkPermission`) call this — previously they used
 * different signals, so a request's nav payload and its enforcement could
 * disagree about which surface it came from.
 *
 * Resolution order:
 *   1. Origin — server-observed and unforgeable. Authoritative when recognised.
 *   2. Referer — for top-level navigations (new-tab download/print links),
 *      which carry no Origin but do carry the opening page's Referer.
 *   3. X-App-Id — client-declared, consulted last. It is NOT trusted:
 *      `enforceInterfaceScope` gates on whatever this returns, so a caller
 *      declaring a scope it does not hold is refused, not honoured. Before
 *      that gating existed, declaring `portal` here (or sending nothing, which
 *      still defaults to 'portal') skipped interface enforcement entirely.
 *
 * `hr` is a real resolution scope: it resolves hr-scoped bundles plus the
 * portal ones the HR roles already hold (see applicableBundleScopes). Today
 * that yields the same set as 'portal' — the difference only appears once an
 * hr-scoped bundle is authored.
 */
export function resolveAppScope(c: Context<HonoEnv>): AppScope {
  const iface = c.var.interface ?? deriveInterface(c.req.header('Origin') ?? '')

  if (iface === 'pwa') return 'pwa'
  if (iface === 'hr') return 'hr'
  if (iface === 'portal') return 'portal'

  // Origin absent or unrecognised. Try the Referer next — a top-level
  // navigation opened in a new tab (the "Download statement" / receipt-print
  // links) carries no Origin but does carry the Referer of the page that
  // opened it. `getAuth` already falls back this way to pick the cookie
  // prefix; without the same step here those links resolved to 'portal' for
  // everyone, so a Team-app user got portal bundles on one request and pwa
  // bundles on the next.
  const referer = c.req.header('Referer')
  if (referer) {
    try {
      const derived = deriveInterface(new URL(referer).origin)
      if (derived !== 'unknown') return derived
    } catch {}
  }

  // Still unattributable — fall back to the client-declared app id. This is
  // NOT trusted: `enforceInterfaceScope` gates on whatever this function
  // returns, so declaring a scope you do not hold is refused rather than
  // honoured.
  const appId = c.req.header('X-App-Id')
  if (appId === 'pwa') return 'pwa'
  if (appId === 'hr') return 'hr'
  return 'portal'
}
