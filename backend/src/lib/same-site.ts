/**
 * The clinic's single registrable domain and the cookie/same-site rules built on
 * it. One source of truth so the cookie's `domain` and the same-site decision can
 * never drift apart.
 *
 * Every first-party app is a subdomain of `deneldental.com`
 * (portal./team./hr./app./reports.) and the API is `api.deneldental.com`, so a
 * browser signed into one app sends its session cookie to the API as a same-site
 * request. Staging is the exception — frontends on `*.pages.dev` with a Render
 * backend are cross-site — which is why this is a decision, not a constant.
 */

/** The registrable domain every first-party app lives under. */
export const APP_BASE_DOMAIN = 'deneldental.com'

/**
 * The parent domain a session cookie is scoped to, so a cookie set by one
 * subdomain is sent by all of them. Used as the cookie `domain` attribute.
 */
export const COOKIE_DOMAIN = `.${APP_BASE_DOMAIN}`

/**
 * Whether a hostname is the app's registrable domain or a subdomain of it.
 *
 * Checked on the registrable-domain boundary, not a bare substring, so neither a
 * suffix collision (`notdeneldental.com`) nor a subdomain trick
 * (`deneldental.com.evil.test`) is mistaken for one of our hosts.
 */
export function isAppDomainHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === APP_BASE_DOMAIN || host.endsWith(`.${APP_BASE_DOMAIN}`)
}

/**
 * Whether this request's frontend and this backend share the registrable domain.
 *
 * True → SameSite=Lax + a `.deneldental.com` parent-domain cookie (production,
 * where both are on deneldental.com). False → SameSite=None is required for the
 * cookie to flow at all (staging: a `*.pages.dev` frontend + a Render backend,
 * or plain http in local dev).
 */
export function sharesSiteWithBackend(
  origin: string,
  betterAuthUrl: string | undefined,
  isHttps: boolean
): boolean {
  if (!isHttps) return false
  let host = ''
  try {
    host = new URL(origin).hostname
  } catch {}
  const backendOnDomain = betterAuthUrl?.includes(APP_BASE_DOMAIN) ?? false
  return isAppDomainHost(host) && backendOnDomain
}
