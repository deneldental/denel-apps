import { env } from '@/config/env'
import { reportError } from '@/shared/lib/error-reporting'

const CSRF_COOKIE_NAME = 'csrf_patient'
const CSRF_HEADER_NAME = 'X-CSRF-Token'
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const APP_ID = 'patient'

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null
  const pairs = document.cookie ? document.cookie.split('; ') : []
  for (const pair of pairs) {
    const eq = pair.indexOf('=')
    if (eq === -1) continue
    if (pair.slice(0, eq) === CSRF_COOKIE_NAME) {
      return decodeURIComponent(pair.slice(eq + 1))
    }
  }
  return null
}

let csrfBootstrapPromise: Promise<void> | null = null
async function ensureCsrfToken(): Promise<string | null> {
  const existing = readCsrfCookie()
  if (existing) return existing
  if (!csrfBootstrapPromise) {
    csrfBootstrapPromise = fetch(`${env.VITE_API_URL}/api/csrf`, {
      method: 'GET',
      credentials: 'include',
      headers: { 'X-App-Id': APP_ID },
    })
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        csrfBootstrapPromise = null
      })
  }
  await csrfBootstrapPromise
  return readCsrfCookie()
}

export interface ApiResponse<T = unknown> {
  success?: boolean
  data?: T
  /** Canonical error field. Old endpoints may also set `message` — read via
   *  the index signature if you really need it, but prefer `error`. */
  error?: string
  /** Returned by forgot-password/verify-otp. */
  otpId?: string
  /** Allow backends to return ad-hoc top-level fields (count, status, ids, …). */
  [key: string]: unknown
}

/**
 * Optional hook the app can register to respond to global 401s (e.g. redirect
 * to /login, clear cached patient). Set via `setOnSessionExpired(handler)` —
 * typically once in main.tsx. Takes the request path so the handler can skip
 * auth-probing endpoints (e.g. `/api/patient-auth/me`) that are *expected* to
 * 401 when no session exists — those must not trigger a redirect loop.
 */
let onSessionExpired: ((path: string) => void) | null = null
export function setOnSessionExpired(handler: ((path: string) => void) | null) {
  onSessionExpired = handler
}

/** Default request timeout. Overridable per call via `options.timeout`. */
const DEFAULT_TIMEOUT_MS = 30_000

export interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  /** Request body — objects are auto-JSON-encoded; FormData passes through. */
  body?: any
  /** Abort request after N ms. Defaults to 30,000. Set to 0 to disable. */
  timeout?: number
  /** Optional external AbortSignal — tie request lifetime to a React component. */
  signal?: AbortSignal
  /**
   * Skip invoking `onSessionExpired` on a 401. Use for endpoints that probe
   * session state and expect 401 as a normal outcome (login page, session
   * polling, etc.).
   */
  suppressSessionExpiredHook?: boolean
}

async function request<T = any>(
  path: string,
  options: ApiRequestOptions = {}
): Promise<ApiResponse<T>> {
  const {
    timeout = DEFAULT_TIMEOUT_MS,
    signal: externalSignal,
    suppressSessionExpiredHook,
    ...rest
  } = options

  // Composite AbortController: internal timeout OR external signal trips it.
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
    const url = `${env.VITE_API_URL}${path.startsWith('/') ? '' : '/'}${path}`

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
      headers: { 'X-App-Id': APP_ID, ...csrfHeaders, ...rest.headers },
    }

    // JSON-encode object bodies (not FormData / Blob / string).
    if (
      rest.body &&
      typeof rest.body === 'object' &&
      !(rest.body instanceof FormData) &&
      !(rest.body instanceof Blob)
    ) {
      init.body = JSON.stringify(rest.body)
      init.headers = {
        'X-App-Id': APP_ID,
        'Content-Type': 'application/json',
        ...csrfHeaders,
        ...rest.headers,
      }
    } else if (rest.body !== undefined) {
      init.body = rest.body as BodyInit
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
      // Suppress mode (sign-in, forgot-password probes, etc.): a 401 is a
      // legitimate response, not a session expiry. Surface the server's actual
      // error message.
      let bodyError: string | undefined
      try {
        const json = await response.json()
        bodyError = typeof json?.error === 'string' ? json.error : undefined
      } catch {
        // body wasn't JSON — fall back to a generic message
      }
      return { success: false, error: bodyError ?? 'Unauthorized' }
    }

    // Parse defensively. Gateways/proxies can return an empty or non-JSON body
    // on 5xx (e.g. a 502 with no body when the backend is down), which would
    // otherwise throw a cryptic "Unexpected end of JSON input".
    let json: ApiResponse<T> | null = null
    try {
      json = await response.json()
    } catch {
      // Non-JSON / empty body — fall through to a clean status-based error.
    }
    if (!response.ok) {
      return { success: false, error: json?.error || `Request failed (${response.status})` }
    }
    return json ?? ({ success: true } as ApiResponse<T>)
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      reportError(error, {
        kind: 'api-timeout',
        path,
        timeoutMs: timeout,
        fingerprint: ['api-timeout', path],
      })
      return { success: false, error: 'Request cancelled or timed out' }
    }
    reportError(error, {
      kind: 'api-network-error',
      path,
      fingerprint: ['api-network-error', path],
    })
    return { success: false, error: error instanceof Error ? error.message : 'Network error' }
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

export const api = {
  get: <T = any>(path: string, options?: ApiRequestOptions) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T = any>(path: string, body?: any, options?: ApiRequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T = any>(path: string, body?: any, options?: ApiRequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T = any>(path: string, options?: ApiRequestOptions) =>
    request<T>(path, { ...options, method: 'DELETE' }),
}
