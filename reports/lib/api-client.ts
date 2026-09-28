if (!import.meta.env.VITE_API_URL) {
  throw new Error('[reports] VITE_API_URL environment variable is required')
}
export const API_BASE_URL = import.meta.env.VITE_API_URL as string

const CSRF_COOKIE_NAME = 'csrf_reports'
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

let csrfBootstrapPromise: Promise<void> | null = null
async function ensureCsrfToken(): Promise<string | null> {
  const existing = readCsrfCookie()
  if (existing) return existing
  if (!csrfBootstrapPromise) {
    csrfBootstrapPromise = fetch(`${API_BASE_URL.replace(/\/+$/, '')}/api/csrf`, {
      method: 'GET',
      credentials: 'include',
      headers: { 'X-App-Id': 'reports' },
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

// Mirrored from portals/src/lib/api-client.ts — kept in sync so legacy reports components compile.
export type ApiResponse<T = unknown> = {
  message?: string
  data?: T
  error?: string
  success: boolean
  smsError?: string
  smsSent?: boolean
  details?: any
  status?: string
  count?: number
}

export async function apiClient<T>(
  path: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  try {
    const url = `${API_BASE_URL.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`

    // Ensure credentials are included for session cookies
    options.credentials = 'include'

    const method = (options.method ?? 'GET').toUpperCase()
    const csrfHeaders: Record<string, string> = {}
    if (UNSAFE_METHODS.has(method)) {
      const token = await ensureCsrfToken()
      if (token) csrfHeaders[CSRF_HEADER_NAME] = token
    }

    options.headers = { 'X-App-Id': 'reports', ...csrfHeaders, ...options.headers }

    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
      options.body = JSON.stringify(options.body)
      options.headers = {
        'X-App-Id': 'reports',
        'Content-Type': 'application/json',
        ...csrfHeaders,
        ...options.headers,
      }
    }

    const response = await fetch(url, options)

    if (response.status === 401) {
      return { error: 'Not authenticated', success: false }
    }

    if (response.status === 403) {
      return { error: 'Unauthorized', success: false }
    }

    const result = await response.json()
    return result
  } catch (error: any) {
    console.error('API Error:', error)
    return { error: error.message || 'Network error', success: false }
  }
}

export const api = {
  get: <T>(path: string, options?: RequestInit) =>
    apiClient<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body: any, options?: RequestInit) =>
    apiClient<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body: any, options?: RequestInit) =>
    apiClient<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body: any, options?: RequestInit) =>
    apiClient<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: RequestInit) =>
    apiClient<T>(path, { ...options, method: 'DELETE' }),
}
