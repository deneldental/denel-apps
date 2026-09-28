import { env } from '@/config/env'
import { reportError } from '@/shared/lib/error-reporting'

const CSRF_COOKIE_NAME = 'csrf_pwa'
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

// Cache the token in memory. Cross-site (e.g. a staging.team.pages.dev frontend
// against a *.onrender.com backend), `cookieAttributes()` in backend/src/lib/csrf.ts
// takes the SameSite=None / no-`domain` branch, so `csrf_pwa` is scoped to the
// backend host and is NOT readable via document.cookie — the ONLY way to obtain
// the token for the X-CSRF-Token header is the /api/csrf response body. The
// cookie still rides along on the actual request (credentials: 'include'), so
// the backend's double-submit comparison passes.
// Mirrors packages/app-kit/src/api/create-api-client.ts and portals/src/lib/api-client.ts.
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
    csrfBootstrapPromise = fetch(`${env.VITE_API_URL}/api/csrf`, {
      method: 'GET',
      credentials: 'include',
      headers: { 'X-App-Id': 'pwa' },
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
 * Optional hook the app can register to respond to global 401s
 * (e.g. redirect to /login, clear cached user, show toast).
 * Set via `setOnSessionExpired(handler)` — typically once in main.tsx.
 *
 * Takes the request path so the handler can skip auth-probing endpoints
 * (e.g. `/api/auth/get-session`, `/api/patient-auth/me`) that are *expected*
 * to 401 when no session exists — those must not trigger a redirect loop.
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
      headers: { 'X-App-Id': 'pwa', ...csrfHeaders, ...rest.headers },
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
        'X-App-Id': 'pwa',
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
      // error message so the user sees "Invalid Staff ID or password" instead
      // of a misleading "Session expired".
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
      // Timeouts are operationally interesting — report so an endpoint that
      // routinely exceeds DEFAULT_TIMEOUT_MS surfaces in Sentry. Fingerprint
      // by path so all timeouts on a given endpoint cluster together.
      reportError(error, {
        kind: 'api-timeout',
        path,
        timeoutMs: timeout,
        fingerprint: ['api-timeout', path],
      })
      return { success: false, error: 'Request cancelled or timed out' }
    }
    // Genuine network failure (DNS, offline, TLS, CORS). Report so ops can
    // see connectivity regressions early.
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

// --- Staff Portal specific endpoints ---

export const staffApi = {
  // Dashboard
  getDashboard: () => api.get('/api/staff-portal/dashboard'),

  // Requests
  getRequests: () => api.get('/api/staff-portal/requests'),
  submitRequest: (data: any) => api.post('/api/staff-portal/requests', data),
  getLeaveBalance: () => api.get('/api/staff-portal/leave-balance'),
  // Configurable request kinds + subtypes (managed in HR Settings).
  getRequestKinds: () => api.get('/api/request-types/kinds'),
  getRequestTypes: () => api.get('/api/request-types'),
  /** Upload a request attachment → returns { url }. */
  uploadAttachment: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('storageCategory', 'staff')
    fd.append('folder', 'requests')
    return api.post<{ url: string }>('/api/upload', fd)
  },
  /** Upload the signed-in staff member's profile photo → returns { url }. */
  uploadAvatar: (file: File | Blob) => {
    const fd = new FormData()
    const f = file instanceof File ? file : new File([file], 'avatar.jpg', { type: 'image/jpeg' })
    fd.append('file', f)
    return api.post<{ url: string }>('/api/staff-portal/avatar', fd)
  },

  // Memos
  getMemos: (type?: string) =>
    api.get(`/api/staff-portal/memos${type ? `?type=${encodeURIComponent(type)}` : ''}`),
  acknowledgeMemo: (memoId: string) => api.post(`/api/staff-portal/memos/${memoId}/acknowledge`),

  // Tasks (assigned via HR Tasks Management)
  getMyTasks: () => api.get('/api/tasks/mine'),
  setTaskStatus: (assignmentId: string, done: boolean) =>
    api.patch(`/api/tasks/assignments/${assignmentId}`, { status: done ? 'done' : 'pending' }),

  // Documents
  getDocuments: () => api.get('/api/staff-portal/documents'),
  // Configurable document-type labels (managed in HR Settings) so custom types
  // render with their proper name instead of a raw slug.
  getStaffDocumentTypes: () => api.get('/api/lookups/staff-document-types'),
  logDocumentAccess: (docId: string, action: 'viewed' | 'downloaded') =>
    api.post(`/api/staff-portal/documents/${docId}/access`, { action }),

  // Breakfast (weekly)
  getBreakfast: () => api.get('/api/staff-portal/breakfast'),
  submitBreakfast: (data: {
    weekStart?: string
    note?: string
    items: { itemId: string; quantity: number }[]
  }) => api.post('/api/staff-portal/breakfast', data),
  acknowledgeBreakfast: (id: string) => api.post(`/api/staff-portal/breakfast/${id}/acknowledge`),

  // Performance
  getPerformance: () => api.get('/api/staff-portal/performance'),
  getQuestionnaires: () => api.get('/api/staff-portal/questionnaires'),
  getQuestionnaireResponses: (weekStartDate?: string) =>
    api.get(
      `/api/staff-portal/questionnaires/responses${weekStartDate ? `?weekStartDate=${encodeURIComponent(weekStartDate)}` : ''}`
    ),
  saveQuestionnaireResponses: (data: {
    weekStartDate: string
    answers: Array<{ questionId: string; score: number }>
  }) => api.post('/api/staff-portal/questionnaires/responses', data),

  // Training
  getTraining: () => api.get('/api/staff-portal/training'),
  updateProgress: (progressId: string, data: any) =>
    api.patch(`/api/staff-portal/training/${progressId}/progress`, data),

  // Profile
  getProfile: () => api.get('/api/staff-portal/profile'),

  // HR Handbook
  getHandbook: () => api.get('/api/settings/hr-handbook'),

  // Attendance
  getAttendance: (weekDate?: string) =>
    api.get(
      `/api/staff-portal/attendance${weekDate ? `?week=${encodeURIComponent(weekDate)}` : ''}`
    ),
  getAttendanceHistory: (page?: number) =>
    api.get(`/api/staff-portal/attendance/history${page ? `?page=${page}` : ''}`),
  submitAttendance: (data: {
    date: string
    punchType: 'clock_in' | 'clock_out'
    time: string
    reason?: string
  }) => api.post('/api/staff-portal/attendance/submissions', data),
  getAttendanceSubmissions: () => api.get('/api/staff-portal/attendance/submissions'),

  // Payslips
  getPayslips: () => api.get('/api/staff-portal/payslips'),
  getPayslip: (id: string) => api.get(`/api/staff-portal/payslips/${id}`),

  // Training quiz
  submitQuiz: (
    trainingId: string,
    answers: Array<{ questionIndex: number; selectedOption: number }>
  ) => api.post(`/api/staff-portal/training/${trainingId}/submit-quiz`, { answers }),

  // Profile change requests
  getProfileChangeRequests: () => api.get('/api/staff-portal/profile/change-requests'),
  submitProfileChangeRequest: (data: {
    changeType: string
    requestedData: {
      field?: string
      currentValue?: string
      requestedValue?: string
      notes?: string
    }
  }) => api.post('/api/staff-portal/profile/change-request', data),

  // Staff auth (passwordless phone + OTP) lives in `@/lib/auth.tsx`, which calls
  // the `/api/staff-auth/*` endpoints directly. Those endpoints now issue a
  // Better Auth session; the contract on this side is unchanged.
}

// --- Public staff self-registration (no session) ---

export interface RegistrationLookup {
  id: string
  name: string
  displayName: string
}
/** @deprecated use RegistrationLookup */
export type RegistrationTitle = RegistrationLookup

/** All calls are public (no auth). The CSRF cookie is minted by the generic
 *  client's first safe request; POSTs then carry the header automatically. */
export const registrationApi = {
  /** Validate the invite token on page load. */
  validateToken: (token: string) =>
    api.get<never>(`/api/staff-registration/public/${token}`, {
      suppressSessionExpiredHook: true,
    }),
  /** Active clinical titles for the Title dropdown. */
  getTitles: () =>
    api.get<RegistrationLookup[]>('/api/staff-registration/public/titles', {
      suppressSessionExpiredHook: true,
    }),
  /** Active departments for the Department dropdown (admin-managed lookup). */
  getDepartments: () =>
    api.get<RegistrationLookup[]>('/api/staff-registration/public/departments', {
      suppressSessionExpiredHook: true,
    }),
  /** Send the phone-verification OTP. In dev the response echoes `devCode`. */
  sendOtp: (token: string, phone: string) =>
    api.post(`/api/staff-registration/public/${token}/send-otp`, { phone }),
  verifyOtp: (token: string, phone: string, code: string) =>
    api.post(`/api/staff-registration/public/${token}/verify-otp`, { phone, code }),
  /** Optional CV upload → { url }. */
  uploadCv: (token: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post<{ url: string }>(`/api/staff-registration/public/${token}/cv`, fd)
  },
  /** Submit the completed form. */
  submit: (token: string, data: Record<string, unknown>) =>
    api.post(`/api/staff-registration/public/${token}/submit`, data),
}

// --- Lab Technician endpoints (Phase 4.3) ---

export const labApi = {
  getCases: (status?: string) =>
    api.get(`/api/labs/cases${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  getCase: (id: string) => api.get(`/api/labs/cases/${id}`),
  updateCase: (id: string, data: any) => api.patch(`/api/labs/cases/${id}`, data),
  uploadPhoto: (caseId: string, photoUrl: string, photoType: string, notes?: string | null) =>
    api.post(`/api/labs/cases/${caseId}/photos`, { photoUrl, photoType, notes }),
  deletePhoto: (photoId: string) => api.delete(`/api/labs/photos/${photoId}`),
  // Phase 2 — configurable progress stages + patient-update SMS.
  getCaseStatuses: () => api.get('/api/labs/case-statuses'),
  getStatusHistory: (caseId: string, limit = 8, offset = 0) =>
    api.get(`/api/labs/cases/${caseId}/status-history?limit=${limit}&offset=${offset}`),
  smsPreview: (caseId: string, status: string) =>
    api.get(`/api/labs/cases/${caseId}/sms-preview?status=${encodeURIComponent(status)}`),
  notifyPatient: (caseId: string, status: string) =>
    api.post(`/api/labs/cases/${caseId}/notify-patient`, { status }),
}

// Staff auth (Better Auth) is now handled by `@/lib/auth-client.ts` — the
// hand-rolled `authApi` block previously here was removed in Sprint PWA-2.
// (Trainer authoring moved to the HR app; patient auth moved to the patient app.)
