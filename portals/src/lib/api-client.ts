export const API_BASE_URL = import.meta.env.VITE_API_URL || ''

const CSRF_COOKIE_NAME = 'csrf_portal'
const CSRF_HEADER_NAME = 'X-CSRF-Token'
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

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

let csrfTokenMemory: string | null = null
let csrfBootstrapPromise: Promise<void> | null = null
async function ensureCsrfToken(): Promise<string | null> {
  if (csrfTokenMemory) return csrfTokenMemory
  const existing = readCsrfCookie()
  if (existing) {
    csrfTokenMemory = existing
    return existing
  }
  if (!csrfBootstrapPromise) {
    csrfBootstrapPromise = fetch(`${API_BASE_URL}/api/csrf`, {
      method: 'GET',
      credentials: 'include',
      headers: { 'X-App-Id': 'portal' },
    })
      .then((res) => res.json())
      .then((data: { token?: string }) => {
        if (data?.token) csrfTokenMemory = data.token
      })
      .catch(() => undefined)
      .finally(() => {
        csrfBootstrapPromise = null
      })
  }
  await csrfBootstrapPromise
  if (!csrfTokenMemory) csrfTokenMemory = readCsrfCookie()
  return csrfTokenMemory
}

export type ApiResponse<T = unknown> = {
  message?: string
  data?: T
  error?: string
  /** Structured error code returned by the backend (e.g. 'LOOKUP_IN_USE'). */
  code?: string
  success: boolean
  smsError?: string
  smsSent?: boolean
  details?: unknown
  status?: string
  count?: number
  /** Field-level zod validation issues returned by the backend on a 400. */
  issues?: Array<{ path?: (string | number)[]; message: string }>
}

/**
 * Optional hook the app can register to respond to global 401s
 * (e.g. redirect to /auth/login, clear cached user, show toast).
 * Set via `setOnSessionExpired(handler)` — typically once, in main.tsx.
 */
let onSessionExpired: (() => void) | null = null
export function setOnSessionExpired(handler: (() => void) | null) {
  onSessionExpired = handler
}

/** Default request timeout. Overridable per call via `options.timeout`. */
const DEFAULT_TIMEOUT_MS = 30_000

export interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  /** Request body — objects are auto-JSON-encoded; FormData passes through. */
  body?: any
  /** Abort request after N ms. Defaults to 30,000. Set to 0 to disable. */
  timeout?: number
  /** Optional external AbortSignal — useful for tying to component lifecycle. */
  signal?: AbortSignal
  /**
   * Skip the global onSessionExpired handler on a 401. For endpoints where a 401
   * is an EXPECTED, non-portal-session outcome (e.g. the kiosk device flow: an
   * unpaired device or a wrong operator PIN), so it doesn't redirect to login.
   */
  suppressSessionExpired?: boolean
}

export async function apiClient<T>(
  path: string,
  options: ApiRequestOptions = {}
): Promise<ApiResponse<T>> {
  const {
    timeout = DEFAULT_TIMEOUT_MS,
    signal: externalSignal,
    suppressSessionExpired,
    ...rest
  } = options

  // Build a composite AbortController: internal timeout OR external signal trips it.
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
    const url = `${API_BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`

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
      headers: { 'X-App-Id': 'portal', ...csrfHeaders, ...rest.headers },
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
        'X-App-Id': 'portal',
        'Content-Type': 'application/json',
        ...csrfHeaders,
        ...rest.headers,
      }
    } else if (rest.body !== undefined) {
      init.body = rest.body as BodyInit
    }

    const response = await fetch(url, init)

    if (response.status === 401) {
      // Notify any registered global handler once per 401, unless this caller
      // expects 401s (e.g. the kiosk device flow) and opted out.
      if (!suppressSessionExpired) {
        try {
          onSessionExpired?.()
        } catch {
          // never let a handler break the response
        }
      }
      return { error: 'Not authenticated', success: false }
    }

    if (response.status === 403) {
      return { error: 'Unauthorized', success: false }
    }

    // Some failures (404 HTML pages, Cloudflare 5xx, proxy errors) return
    // non-JSON. Parsing those as JSON throws an opaque SyntaxError that's
    // miles from the real problem. Read once as text, parse if it looks like
    // JSON, otherwise return a structured error with the status code.
    const raw = await response.text()
    if (!raw) {
      if (response.ok) return { success: true } as ApiResponse<T>
      return {
        success: false,
        error: `Request failed (${response.status})`,
      }
    }
    const trimmed = raw.trimStart()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.parse(raw) as ApiResponse<T>
      } catch {
        // fall through to the non-JSON path
      }
    }
    if (!response.ok) {
      return {
        success: false,
        error: `Request failed (${response.status})`,
      }
    }
    return { success: false, error: 'Unexpected non-JSON response from server' }
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { error: 'Request cancelled or timed out', success: false }
    }
    console.error('API Error:', error)
    return { error: error instanceof Error ? error.message : 'Network error', success: false }
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

/**
 * POST that returns the raw Response so the caller can read a streaming body
 * (Server-Sent Events). Shares this module's auth setup — cookies, `X-App-Id`
 * and the CSRF token — so a streaming endpoint cannot drift from the rest.
 *
 * No timeout: an SSE body stays open by design, and the 30s default would abort
 * a long import midway.
 */
export async function postStream(
  path: string,
  body: unknown,
  options: { signal?: AbortSignal } = {}
): Promise<Response> {
  const token = await ensureCsrfToken()
  return fetch(`${API_BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`, {
    method: 'POST',
    credentials: 'include',
    signal: options.signal,
    headers: {
      'X-App-Id': 'portal',
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(token ? { [CSRF_HEADER_NAME]: token } : {}),
    },
    body: JSON.stringify(body),
  })
}

/**
 * Read an SSE response body, invoking `onEvent(event, data)` per message.
 * Frames are separated by a blank line; a frame split across chunks is held in
 * `buffer` until complete, which a naive per-chunk parse would corrupt.
 */
export async function readSSE(
  response: Response,
  onEvent: (event: string, data: string) => void
): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Streaming not supported by this response')
  const decoder = new TextDecoder()
  const FRAME_SEP = '\n\n'
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let sep = buffer.indexOf(FRAME_SEP)
    while (sep !== -1) {
      const frame = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      let eventName = 'message'
      const dataLines: string[] = []
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
      }
      if (dataLines.length > 0) onEvent(eventName, dataLines.join('\n'))
      sep = buffer.indexOf(FRAME_SEP)
    }
  }
}

export const api = {
  get: <T>(path: string, options?: ApiRequestOptions) =>
    apiClient<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body: any, options?: ApiRequestOptions) =>
    apiClient<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body: any, options?: ApiRequestOptions) =>
    apiClient<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body: any, options?: ApiRequestOptions) =>
    apiClient<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: ApiRequestOptions) =>
    apiClient<T>(path, { ...options, method: 'DELETE' }),
}
