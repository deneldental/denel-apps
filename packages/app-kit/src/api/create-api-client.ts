/**
 * Shared API client factory.
 *
 * Produces a typed `api.get/post/patch/delete` helper bound to one app's
 * config — backend URL, `X-App-Id`, optional error reporter. Generalised from
 * the PWA's hand-rolled client so portal / pwa / hr share one implementation.
 *
 * Behaviour: cookie-based auth (`credentials: 'include'`), CSRF bootstrap for
 * unsafe methods, per-request timeout/abort, and a pluggable session-expired
 * hook.
 */

const DEFAULT_CSRF_COOKIE_NAME = 'csrf_token'
const CSRF_HEADER_NAME = 'X-CSRF-Token'

/**
 * Per-app CSRF cookie names, keyed by `X-App-Id`. Every Framada app shares the
 * backend host, so a single `csrf_token` cookie would be clobbered when several
 * apps are open in one browser. Each app reads/sends its own. Must stay in sync
 * with the backend's `CSRF_COOKIE_BY_APP` map (backend/src/lib/csrf.ts).
 */
const CSRF_COOKIE_BY_APP: Record<string, string> = {
  patient: 'csrf_patient',
  pwa: 'csrf_pwa',
  portal: 'csrf_portal',
  hr: 'csrf_hr',
  reports: 'csrf_reports',
}
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const DEFAULT_TIMEOUT_MS = 30_000

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  /** Canonical error field. Prefer this over `message`. */
  error?: string
  /** Human-readable message some endpoints return alongside success. */
  message?: string
  /** Returned by forgot-password / verify-otp flows. */
  otpId?: string
  /** Structured backend error code (e.g. 'LOOKUP_IN_USE'). */
  code?: string
  /** Field-level zod validation issues returned by the backend on a 400. */
  issues?: Array<{ path?: (string | number)[]; message: string }>
  /** Allow backends to return ad-hoc top-level fields (count, status, ids, …). */
  [key: string]: unknown
}

export interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  /** Request body — objects are auto-JSON-encoded; FormData / Blob pass through. */
  body?: unknown
  /** Abort request after N ms. Defaults to 30,000. Set to 0 to disable. */
  timeout?: number
  /** Optional external AbortSignal — tie request lifetime to a React component. */
  signal?: AbortSignal
  /**
   * Skip invoking the session-expired hook on a 401. Use for endpoints that
   * probe session state and expect 401 as a normal outcome (login, polling).
   */
  suppressSessionExpiredHook?: boolean
}

export interface ApiClientConfig {
  /** Backend base URL (no trailing slash), e.g. https://api.deneldental.com */
  apiUrl: string
  /** App identifier sent as `X-App-Id` (e.g. 'portal' | 'pwa' | 'hr'). */
  appId: string
  /** Optional telemetry sink for timeouts / network errors. */
  reportError?: (error: unknown, context?: Record<string, unknown>) => void
}

export interface ApiClient {
  get: <T = unknown>(path: string, options?: ApiRequestOptions) => Promise<ApiResponse<T>>
  post: <T = unknown>(
    path: string,
    body?: unknown,
    options?: ApiRequestOptions
  ) => Promise<ApiResponse<T>>
  patch: <T = unknown>(
    path: string,
    body?: unknown,
    options?: ApiRequestOptions
  ) => Promise<ApiResponse<T>>
  put: <T = unknown>(
    path: string,
    body?: unknown,
    options?: ApiRequestOptions
  ) => Promise<ApiResponse<T>>
  delete: <T = unknown>(path: string, options?: ApiRequestOptions) => Promise<ApiResponse<T>>
  /**
   * Register a handler invoked on a global 401 (e.g. redirect to login, clear
   * cached user). Receives the request path so probing endpoints can be skipped.
   */
  setOnSessionExpired: (handler: ((path: string) => void) | null) => void
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  const { apiUrl, appId, reportError } = config
  const csrfCookieName = CSRF_COOKIE_BY_APP[appId] ?? DEFAULT_CSRF_COOKIE_NAME

  let onSessionExpired: ((path: string) => void) | null = null

  function readCsrfCookie(): string | null {
    if (typeof document === 'undefined') return null
    const pairs = document.cookie ? document.cookie.split('; ') : []
    for (const pair of pairs) {
      const eq = pair.indexOf('=')
      if (eq === -1) continue
      if (pair.slice(0, eq) === csrfCookieName) {
        return decodeURIComponent(pair.slice(eq + 1))
      }
    }
    return null
  }

  // Cache the token in memory. Cross-site (e.g. hr-105.pages.dev frontend +
  // *.deneldental.com backend), the `csrf_token` cookie is scoped to the backend
  // host and is NOT readable via document.cookie — so the ONLY way to obtain
  // the token for the X-CSRF-Token header is the /api/csrf response body. The
  // cookie still rides along on the actual request (credentials: 'include'),
  // so the backend's double-submit comparison passes.
  let csrfTokenMemory: string | null = null
  let csrfBootstrapPromise: Promise<void> | null = null
  async function ensureCsrfToken(): Promise<string | null> {
    if (csrfTokenMemory) return csrfTokenMemory
    const existing = readCsrfCookie()
    if (existing) {
      csrfTokenMemory = existing
      return csrfTokenMemory
    }
    if (!csrfBootstrapPromise) {
      // Bounded the same as every other request's DEFAULT_TIMEOUT_MS — this
      // fetch previously had no signal/timeout at all, so a stalled backend
      // could block the first mutation of a session far longer than the
      // documented 30s bound every other request gets.
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
      csrfBootstrapPromise = fetch(`${apiUrl}/api/csrf`, {
        method: 'GET',
        credentials: 'include',
        headers: { 'X-App-Id': appId },
        signal: controller.signal,
      })
        .then((res) => res.json())
        .then((data: { token?: string }) => {
          if (data?.token) csrfTokenMemory = data.token
        })
        .catch(() => undefined)
        .finally(() => {
          clearTimeout(timeoutId)
          csrfBootstrapPromise = null
        })
    }
    await csrfBootstrapPromise
    if (!csrfTokenMemory) csrfTokenMemory = readCsrfCookie()
    return csrfTokenMemory
  }

  async function request<T = unknown>(
    path: string,
    options: ApiRequestOptions = {}
  ): Promise<ApiResponse<T>> {
    const {
      body,
      timeout = DEFAULT_TIMEOUT_MS,
      signal: externalSignal,
      suppressSessionExpiredHook,
      ...rest
    } = options

    const controller = new AbortController()
    const timeoutId =
      timeout > 0
        ? setTimeout(
            () => controller.abort(new DOMException('Request timeout', 'AbortError')),
            timeout
          )
        : null

    if (externalSignal) {
      if (externalSignal.aborted) controller.abort(externalSignal.reason)
      else
        externalSignal.addEventListener('abort', () => controller.abort(externalSignal.reason), {
          once: true,
        })
    }

    try {
      const url = `${apiUrl}${path.startsWith('/') ? '' : '/'}${path}`
      const method = (rest.method ?? 'GET').toUpperCase()

      const csrfHeaders: Record<string, string> = {}
      if (UNSAFE_METHODS.has(method)) {
        const token = await ensureCsrfToken()
        if (token) csrfHeaders[CSRF_HEADER_NAME] = token
      }

      const init: RequestInit = {
        ...rest,
        credentials: 'include',
        signal: controller.signal,
        headers: { 'X-App-Id': appId, ...csrfHeaders, ...rest.headers },
      }

      // JSON-encode object bodies (not FormData / Blob / string).
      if (
        body &&
        typeof body === 'object' &&
        !(body instanceof FormData) &&
        !(body instanceof Blob)
      ) {
        init.body = JSON.stringify(body)
        init.headers = {
          'X-App-Id': appId,
          'Content-Type': 'application/json',
          ...csrfHeaders,
          ...rest.headers,
        }
      } else if (body !== undefined) {
        init.body = body as BodyInit
      }

      const response = await fetch(url, init)

      if (response.status === 401) {
        if (!suppressSessionExpiredHook) {
          try {
            onSessionExpired?.(path)
          } catch {
            // never let a handler break the response
          }
          return { success: false, error: 'Session expired. Please sign in again.' }
        }
        let bodyError: string | undefined
        try {
          const json = await response.json()
          bodyError = typeof json?.error === 'string' ? json.error : undefined
        } catch {
          // body wasn't JSON — fall back to a generic message
        }
        return { success: false, error: bodyError ?? 'Unauthorized' }
      }

      const json = await response.json()
      if (!response.ok) {
        // Carry the rest of the error body through — `code`, `data`, `issues`.
        // Discarding them made the documented `code` field above unreachable
        // for every failing request, so callers had no way to tell two 409s
        // apart except by matching on prose.
        return {
          ...json,
          success: false,
          error: json.error || `Request failed (${response.status})`,
        }
      }
      return json
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        reportError?.(error, {
          kind: 'api-timeout',
          path,
          timeoutMs: timeout,
          fingerprint: ['api-timeout', path],
        })
        return { success: false, error: 'Request cancelled or timed out' }
      }
      reportError?.(error, {
        kind: 'api-network-error',
        path,
        fingerprint: ['api-network-error', path],
      })
      return { success: false, error: error instanceof Error ? error.message : 'Network error' }
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
    }
  }

  return {
    get: (path, options) => request(path, { ...options, method: 'GET' }),
    post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
    patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
    put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
    delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
    setOnSessionExpired: (handler) => {
      onSessionExpired = handler
    },
  }
}
