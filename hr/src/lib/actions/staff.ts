import { API_BASE_URL, api } from '@/lib/api-client'
import type {
  documentAccessLogs,
  staff,
  staffDocuments,
  staffTrainingProgress,
  trainingMaterials,
} from '@/lib/db/schema'

/** Drizzle infers timestamp columns as `Date`, but every response here
 *  crosses the wire through Hono's `c.json()`, which serializes Date to an
 *  ISO string — so a raw `$inferSelect` describes the DB row, not what the
 *  frontend actually receives. */
type Serialized<T> = {
  [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | null ? string | null : T[K]
}

/** A staff row as the list/create/update endpoints return it — the raw DB
 *  row plus the linked auth user's role/ban state, projected on top by the
 *  backend (see staff-core.ts's `/`, `/:id`, POST `/`, PATCH `/:id`). */
export type StaffRecord = Serialized<typeof staff.$inferSelect> & {
  role: string | null
  banned: boolean
}

/** Read by StaffPerformanceTab (features/staff/components/staff-performance-tab.tsx). */
export type TrainingProgressRecord = Serialized<typeof staffTrainingProgress.$inferSelect> & {
  training?: Serialized<typeof trainingMaterials.$inferSelect>
}

/** GET /:id additionally joins `requests`/`performanceScores` onto the base
 *  record too — genuinely unread by any current frontend caller, so left as
 *  `unknown[]` rather than invented. */
export type StaffDetailRecord = StaffRecord & {
  documents?: StaffDocumentRecord[]
  requests?: unknown[]
  performanceScores?: unknown[]
  trainingProgress?: TrainingProgressRecord[]
}

export async function getStaff() {
  const res = await api.get<StaffRecord[]>('/api/staff')
  return { success: res.success, data: res.data || [], error: res.error }
}

// ── HR dashboard ──────────────────────────────────────────────────────────────

export type HrDashboardData = {
  generatedAt: string
  weekStart: string
  weekEnd: string
  headcount: {
    activeTotal: number
    byStaffType: Record<string, number>
  }
  pending: { requests: number; profileChanges: number }
  expiringCredentials: Array<{
    id: string
    staffId: string
    staffName: string | null
    credentialType: string
    credentialName: string
    expiryDate: string | null
    status: 'expired' | 'expiring'
  }>
  whosOutThisWeek: Array<{
    id: string
    staffId: string
    staffName: string | null
    startDate: string | null
    endDate: string | null
    requestType: string
    subType: string | null
  }>
  recentNewHires: Array<{
    id: string
    fullName: string
    position: string | null
    dateOfJoining: string | null
    profileImage: string | null
  }>
  upcomingAnniversaries: Array<{
    id: string
    fullName: string
    dateOfJoining: string | null
    position: string | null
  }>
  upcomingBirthdays?: Array<{
    id: string
    fullName: string
    /** Day of month (1-31). Null if the staff hasn't set a birthday. */
    birthDay: number | null
    /** Month (1-12). Null if the staff hasn't set a birthday. */
    birthMonth: number | null
    position: string | null
  }>
}

export async function getHrDashboard() {
  const res = await api.get<HrDashboardData>('/api/staff/hr-dashboard')
  return { success: res.success, data: res.data, error: res.error }
}

export async function getStaffMember(id: string) {
  const res = await api.get<StaffDetailRecord>(`/api/staff/${id}`)
  return { success: res.success, data: res.data, error: res.error }
}

// ── Trainer-side reads (PR-35) ──────────────────────────────────────────────

export type TrainerLearnerProgress = {
  trainingId: string
  title: string
  status: string
  progressPercent: number
  score: number | null
  completedAt: string | null
}

export type TrainerLearner = {
  id: string
  name: string
  email: string | null
  role: string | null
  progressByModule: TrainerLearnerProgress[]
}

export type TrainerLearnersResponse = {
  trainer: { id: string; userId: string | null; fullName: string }
  learners: TrainerLearner[]
}

export async function getTrainerLearners(trainerStaffId: string) {
  return api.get<TrainerLearnersResponse>(`/api/staff/training/trainers/${trainerStaffId}/learners`)
}

// PR-42 — /training/learners admin view: every active non-trainer staff +
// their progress across all materials. Materialtype is surfaced so the
// portal can show the right icon (module vs quiz).
export type AdminLearnerProgress = TrainerLearnerProgress & {
  materialType: string
}
export type AdminLearner = Omit<TrainerLearner, 'progressByModule'> & {
  progressByModule: AdminLearnerProgress[]
}

export async function getAllLearnersAdmin() {
  return api.get<AdminLearner[]>('/api/staff/training/learners-admin')
}

// ── Training assignment (PR-39) ─────────────────────────────────────────────

export type TrainingMaterialSummary = {
  id: string
  title: string
  description: string | null
  materialType: string
  published: boolean
  isMandatory: boolean
  deadline: string | null
  assignedTo: string[] | null
}

export async function listTrainingMaterials() {
  return api.get<TrainingMaterialSummary[]>('/api/staff/training/all')
}

export async function assignTrainingToStaff(trainingId: string, staffIds: string[]) {
  return api.post<{ added: number; total: number; alreadyBroadcast?: boolean }>(
    `/api/staff/training/${trainingId}/assign-staff`,
    { staffIds }
  )
}

// ── Annual leave balance (PR-21) ────────────────────────────────────────────

export type LeaveSplit = {
  totalQuota: number
  annualQuota: number
  annualUsed: number
  annualRemaining: number
  casualQuota: number
  casualUsed: number
  casualRemaining: number
  casualExhausted: boolean
}

export type LeaveBalance = {
  staffId: string
  year: number
  entitlement: number
  used: number
  remaining: number
  source: 'override' | 'clinic_default'
  split: LeaveSplit
  breakdown: Array<{
    requestId: string
    subType: string
    startDate: string | null
    endDate: string | null
    days: number
  }>
}

export async function getStaffLeaveBalance(staffId: string, year?: number) {
  const qs = year ? `?year=${year}` : ''
  return api.get<LeaveBalance>(`/api/staff/leave-balance/${staffId}${qs}`)
}

/** A request-kind slug. The four built-ins (leave | permit | emergency |
 *  official_support) carry special backend behaviour; custom kinds are plain
 *  slugs, so this is just `string`. */
export type RequestCategory = string

export interface RequestKind {
  id: string
  name: string
  displayName: string
  showsDates: boolean
  showsAmount: boolean
  isSystem: boolean
  isActive: boolean
  displayOrder: number
}

/** Top-level request kinds (parent of subtypes). ?all=1 for inactive too. */
export function getRequestKinds(includeInactive = false) {
  return api.get<RequestKind[]>(`/api/request-types/kinds${includeInactive ? '?all=1' : ''}`)
}

export function createRequestKind(input: {
  displayName: string
  showsDates?: boolean
  showsAmount?: boolean
}) {
  return api.post<RequestKind>('/api/request-types/kinds', input)
}

export function updateRequestKind(
  id: string,
  patch: {
    displayName?: string
    isActive?: boolean
    displayOrder?: number
    showsDates?: boolean
    showsAmount?: boolean
  }
) {
  return api.patch(`/api/request-types/kinds/${id}`, patch)
}

export function deleteRequestKind(id: string) {
  return api.delete(`/api/request-types/kinds/${id}`)
}

export interface RequestSubtype {
  id: string
  category: string
  name: string
  displayName: string
  displayOrder: number
  isActive: boolean
}

/** Configurable request subtypes ("Types"), shared with the staff app. ?all=1 for inactive. */
export function getRequestSubtypes(includeInactive = false) {
  return api.get<RequestSubtype[]>(`/api/request-types${includeInactive ? '?all=1' : ''}`)
}

export function createRequestSubtype(input: { category: string; displayName: string }) {
  return api.post<RequestSubtype>('/api/request-types', input)
}

export function updateRequestSubtype(
  id: string,
  patch: { displayName?: string; isActive?: boolean }
) {
  return api.patch(`/api/request-types/${id}`, patch)
}

export function deleteRequestSubtype(id: string) {
  return api.delete(`/api/request-types/${id}`)
}

/** HR files a request on behalf of a staff member (any category). */
export async function createLeaveRequestForStaff(input: {
  staffId: string
  requestType?: RequestCategory
  subType?: string
  startDate?: string
  endDate?: string
  reason?: string
  description?: string
  amount?: number
  urgencyLevel?: string
}) {
  return api.post<{ id: string }>('/api/staff/leave-requests', input)
}

/** The create payload spans ~30 optional biographical/employment/payout
 *  fields (see the caller in features/staff/pages/staff.tsx) — deliberately
 *  loose, matching how that caller already treats it. */
export async function createStaff(data: Record<string, unknown>) {
  const res = await api.post<StaffRecord & { generatedStaffId: string; message: string }>(
    '/api/staff',
    data
  )
  return res
}

export async function updateStaff(id: string, data: Partial<typeof staff.$inferInsert>) {
  const res = await api.patch<StaffRecord>(`/api/staff/${id}`, data)
  return res
}

export async function deleteStaff(id: string) {
  const res = await api.delete<unknown>(`/api/staff/${id}`)
  return res
}

/** Admin resets a staff member's sign-in password. Forces change on next login. */
export async function resetStaffPassword(staffId: string, newPassword: string) {
  return api.post<{ success: boolean; message?: string }>(`/api/staff/${staffId}/reset-password`, {
    newPassword,
  })
}

/** GET /:id/documents additionally joins `accessLogs` — read by
 *  DocumentsCard's data table (features/staff/pages/detail.tsx). */
export type StaffDocumentRecord = Serialized<typeof staffDocuments.$inferSelect> & {
  accessLogs?: Serialized<typeof documentAccessLogs.$inferSelect>[]
}

export async function getStaffDocuments(staffId: string) {
  const res = await api.get<StaffDocumentRecord[]>(`/api/staff/${staffId}/documents`)
  return res.data || []
}

export interface StaffSession {
  id: string
  userAgent: string | null
  ipAddress: string | null
  lastUsedAt: string
  createdAt: string
  expiresAt: string
}

/** Active Team-app (staff PWA) login sessions for a staff member. */
export async function getStaffSessions(staffId: string) {
  const res = await api.get<StaffSession[]>(`/api/staff/${staffId}/sessions`)
  return { success: res.success, data: res.data ?? [], error: res.error }
}

/** Revoke one Team-app session (sign that device out). */
export async function revokeStaffSession(staffId: string, sessionId: string) {
  return api.delete<unknown>(`/api/staff/${staffId}/sessions/${sessionId}`)
}

export async function addStaffDocument(data: typeof staffDocuments.$inferInsert) {
  const res = await api.post<Serialized<typeof staffDocuments.$inferSelect>>(
    '/api/staff/documents',
    data
  )
  return res
}

export async function updateStaffDocument(
  id: string,
  data: Partial<typeof staffDocuments.$inferInsert>
) {
  const res = await api.patch<Serialized<typeof staffDocuments.$inferSelect>>(
    `/api/staff/documents/${id}`,
    data
  )
  return res
}

export async function deleteStaffDocument(id: string) {
  const res = await api.delete<unknown>(`/api/staff/documents/${id}`)
  return res
}

// ── Performance & Attendance ────────────────────────────────────────────────

export interface MonthlyPerformanceRow {
  staffId: string
  fullName: string
  role: string
  staffType: string
  trainingsCompleted: number
  trainingScorePct: number | null
  trainingTotalPoints: number
  trainingMaxPoints: number
  /** Phase 5C — monthly drill average across all drill attempts in this month. */
  drillCount: number
  drillScorePct: number | null
  attendancePct: number
  daysPresent: number
  daysLate: number
  daysAbsent: number
}

export interface AttendanceMonthlyRow {
  staffId: string
  /** Auth user id (for matching the current session). PR-20. */
  userId: string | null
  fullName: string
  role: string
  staffType: string
  deviceUserId: string | null
  /** Capability flag on the staff record. Drives the admin show/hide toggle. */
  tracksAttendance: boolean
  daysPresent: number
  daysLate: number
  daysAbsent: number
  daysExcused: number
  scoringDays: number
  attendancePct: number
  totalScore: number
  maxScore: number
  month: string
}

export interface DailyRecord {
  date: string
  dayOfWeek: number
  clockIn: string | null
  clockOut: string | null
  clockInStatus: string
  clockOutStatus: string
  status: 'present' | 'late' | 'absent' | 'excused' | 'off' | 'holiday' | 'on_leave'
  dailyScore: number
  isScoringDay: boolean
  isNoShow: boolean
  exceptionReason?: string | null
  /** Id of the admin off-day exclusion on this date, if any (for Remove/Restore). */
  exceptionId?: string | null
}

export interface AttendanceDetail {
  staff: {
    id: string
    fullName: string
    role: string
    staffType: string
    deviceUserId: string | null
  }
  summary: {
    month: string
    daysPresent: number
    daysLate: number
    daysAbsent: number
    daysExcused: number
    scoringDays: number
    attendancePct: number
    totalScore: number
    maxScore: number
  }
  daily: DailyRecord[]
}

export async function getMonthlyPerformance(
  month: string,
  staffType: 'internal' | 'external' | 'all' = 'internal'
) {
  const res = await api.get<MonthlyPerformanceRow[]>(
    `/api/staff/performance/monthly?month=${month}&staffType=${staffType}`
  )
  return { success: res.success, data: res.data ?? [], error: res.error }
}

/** Last `months` rows for one staff. Each call hits /performance/monthly with
 * staffId filter; rows are returned newest-first. */
export async function getStaffPerformanceHistory(staffId: string, months = 6) {
  const out: MonthlyPerformanceRow[] = []
  const now = new Date()
  // Use UTC to align with the backend's month boundaries.
  const promises: Promise<{ month: string; row: MonthlyPerformanceRow | null }>[] = []
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    promises.push(
      api
        .get<MonthlyPerformanceRow[]>(
          `/api/staff/performance/monthly?month=${month}&staffId=${staffId}`
        )
        .then((res) => ({ month, row: res.success ? (res.data?.[0] ?? null) : null }))
    )
  }
  const results = await Promise.all(promises)
  for (const r of results) {
    if (r.row) out.push({ ...r.row, ...({ month: r.month } as object) } as MonthlyPerformanceRow)
  }
  return { success: true, data: out }
}

export async function getAttendance(
  month: string,
  staffType: 'all' | 'internal' | 'external' = 'all'
) {
  const res = await api.get<AttendanceMonthlyRow[]>(
    `/api/staff/attendance?month=${month}&staffType=${staffType}`
  )
  return { success: res.success, data: res.data ?? [], error: res.error }
}

export async function getStaffAttendance(staffId: string, month: string) {
  const res = await api.get<AttendanceDetail>(`/api/staff/attendance/${staffId}?month=${month}`)
  return { success: res.success, data: res.data, error: res.error }
}

// ── All-staff daily clock records (Records calendar + single-day views) ──────

export interface DailyAttendanceRecord {
  staffId: string
  staffName: string
  staffCode: string
  date: string // YYYY-MM-DD
  clockIn: string | null // HH:MM
  clockOut: string | null // HH:MM
  clockInStatus: 'on_time' | 'late_mild' | 'late_severe' | 'no_show'
  clockOutStatus: 'on_time' | 'early' | 'very_early' | 'unknown'
  status: 'present' | 'late' | 'absent' | 'excused' | 'off' | 'holiday' | 'on_leave'
}

export async function getDailyAttendance(month: string) {
  const res = await api.get<DailyAttendanceRecord[]>(`/api/staff/attendance/daily?month=${month}`)
  return { success: res.success, data: res.data ?? [], error: res.error }
}

// ── Per-staff weekly attendance + PDF print ─────────────────────────────────

export interface WeeklyAttendanceWeek {
  weekStart: string
  weekEnd: string
  label: string
  totalPoints: number
  maxPoints: number
  daysPresent: number
  daysLate: number
  daysAbsent: number
  days: DailyRecord[]
}

export interface WeeklyAttendanceResponse {
  staff: { id: string; fullName: string; staffId: string }
  weeks: WeeklyAttendanceWeek[]
}

export async function getStaffAttendanceWeekly(staffId: string, weeks = 8) {
  const res = await api.get<WeeklyAttendanceResponse>(
    `/api/staff/attendance/${staffId}/weekly?weeks=${weeks}`
  )
  return { success: res.success, data: res.data, error: res.error }
}

/** Triggers a browser download of the printable attendance PDF. */
export async function downloadStaffAttendancePdf(staffId: string, weeks = 8) {
  const url = `${API_BASE_URL}/api/staff/attendance/${staffId}/pdf?weeks=${weeks}`
  // Cookie-based session is sent automatically with credentials:'include' so
  // we just need a plain anchor click (or fetch + blob URL).
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30_000)
  let res: Response
  try {
    res = await fetch(url, { credentials: 'include', signal: controller.signal })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Request cancelled or timed out')
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
  if (!res.ok) {
    let msg = `Failed to download PDF (${res.status})`
    try {
      const body = await res.json()
      if (body?.error) msg = body.error
    } catch {}
    throw new Error(msg)
  }
  const blob = await res.blob()
  const blobUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobUrl
  a.download =
    res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'attendance.pdf'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(blobUrl)
}

export interface AttendanceUploadResult {
  success: boolean
  inserted: number
  submitted: number
  skippedDuplicate: number
  unmappedDeviceUserIds: string[]
  parseErrors: string[]
  error?: string
}

export async function uploadAttendanceCsv(file: File): Promise<AttendanceUploadResult> {
  const form = new FormData()
  form.append('file', file)
  const res = await api.post<{
    success?: boolean
    inserted: number
    submitted: number
    skippedDuplicate: number
    unmappedDeviceUserIds: string[]
    parseErrors: string[]
  }>('/api/staff/attendance/upload', form)
  if (!res.success) {
    return {
      success: false,
      inserted: 0,
      submitted: 0,
      skippedDuplicate: 0,
      unmappedDeviceUserIds: [],
      parseErrors: [],
      error: res.error,
    }
  }
  return {
    success: true,
    inserted: res.data?.inserted ?? 0,
    submitted: res.data?.submitted ?? 0,
    skippedDuplicate: res.data?.skippedDuplicate ?? 0,
    unmappedDeviceUserIds: res.data?.unmappedDeviceUserIds ?? [],
    parseErrors: res.data?.parseErrors ?? [],
  }
}

// ── HR Attendance settings ──────────────────────────────────────────────────

export interface OffDayRow {
  id: string
  staffId: string
  dayOfWeek: number
  reason: string | null
  createdAt: string
}

export interface HolidayRow {
  id: string
  date: string // YYYY-MM-DD
  name: string
  /** 'full' = non-scoring; 'half' = clinic closes early (early clock-out waived). */
  type: 'full' | 'half'
  createdAt: string
}

export interface ExceptionRow {
  id: string
  staffId: string
  date: string // YYYY-MM-DD
  type: 'excused_absence' | 'off_day' | 'holiday'
  reason: string | null
  createdAt: string
  staffName?: string | null
}

export async function getStaffOffDays(staffId: string) {
  const res = await api.get<OffDayRow[]>(`/api/staff/off-days/${staffId}`)
  return { success: res.success, data: res.data ?? [], error: res.error }
}

export interface OffDayOverviewRow extends OffDayRow {
  staffName: string | null
}

export async function getAllStaffOffDays() {
  const res = await api.get<OffDayOverviewRow[]>('/api/staff/off-days')
  return { success: res.success, data: res.data ?? [], error: res.error }
}

export async function setStaffOffDay(staffId: string, dayOfWeek: number, reason?: string) {
  return api.post<OffDayRow | null>('/api/staff/off-days', { staffId, dayOfWeek, reason })
}

export async function deleteStaffOffDay(staffId: string, dayOfWeek: number) {
  return api.delete<unknown>(`/api/staff/off-days/${staffId}/${dayOfWeek}`)
}

export async function getHolidays(opts?: { from?: string; to?: string }) {
  const q = new URLSearchParams()
  if (opts?.from) q.set('from', opts.from)
  if (opts?.to) q.set('to', opts.to)
  const qs = q.toString()
  const res = await api.get<HolidayRow[]>(`/api/staff/holidays${qs ? `?${qs}` : ''}`)
  return { success: res.success, data: res.data ?? [], error: res.error }
}

export async function upsertHoliday(date: string, name: string, type: 'full' | 'half' = 'full') {
  return api.post<HolidayRow>('/api/staff/holidays', { date, name, type })
}

export async function deleteHoliday(id: string) {
  return api.delete<unknown>(`/api/staff/holidays/${id}`)
}

export async function getAttendanceExceptions(opts?: {
  staffId?: string
  from?: string
  to?: string
}) {
  const q = new URLSearchParams()
  if (opts?.staffId) q.set('staffId', opts.staffId)
  if (opts?.from) q.set('from', opts.from)
  if (opts?.to) q.set('to', opts.to)
  const qs = q.toString()
  const res = await api.get<ExceptionRow[]>(`/api/staff/attendance-exceptions${qs ? `?${qs}` : ''}`)
  return { success: res.success, data: res.data ?? [], error: res.error }
}

export async function upsertAttendanceException(payload: {
  staffId: string
  date: string
  type: ExceptionRow['type']
  reason?: string
}) {
  return api.post<ExceptionRow>('/api/staff/attendance-exceptions', payload)
}

export async function deleteAttendanceException(id: string) {
  return api.delete<unknown>(`/api/staff/attendance-exceptions/${id}`)
}

/**
 * Bulk-exclude a date span for one staff (inclusive). Used to remove dates that
 * should not have attendance records — e.g. pre-hire days or extended leave.
 */
export async function upsertAttendanceExceptionRange(payload: {
  staffId: string
  from: string
  to: string
  type: ExceptionRow['type']
  reason?: string
}) {
  return api.post<{ count: number }>('/api/staff/attendance-exceptions/range', payload)
}

export interface AttendanceSubmission {
  id: string
  staffId: string
  staffName: string
  date: string
  punchType: 'clock_in' | 'clock_out'
  time: string
  reason: string | null
  status: 'pending' | 'approved' | 'rejected'
  createdAt: string
}

export async function getAttendanceSubmissions() {
  const res = await api.get<AttendanceSubmission[]>('/api/staff/attendance/submissions')
  return { success: res.success, data: res.data ?? [], error: res.error }
}

export async function approveAttendanceSubmission(id: string) {
  return api.post<{ success: boolean }>(`/api/staff/attendance/submissions/${id}/approve`)
}

export async function rejectAttendanceSubmission(id: string) {
  return api.post<{ success: boolean }>(`/api/staff/attendance/submissions/${id}/reject`)
}

// ── Lateness log (Attendance › Lateness Log tab) ────────────────────────────
//
// Per-staff lateness counts for a month plus the escalating queries the weekly
// lateness-policy cron issued, each carrying the outcome of the alert SMS it
// tried to send. Read-only — the escalation itself is the cron's job.

export type LatenessSmsStatus = 'sent' | 'failed' | 'no_phone' | null

export interface LatenessLateDate {
  date: string // YYYY-MM-DD
  clockIn: string | null // HH:MM
  severity: 'on_time' | 'late_mild' | 'late_severe' | 'no_show'
}

export interface LatenessStaffRow {
  staffId: string
  fullName: string
  role: string | null
  phone: string | null
  /** Late days inside the selected month. */
  lateDays: number
  lateDates: LatenessLateDate[]
  /** Queries issued for weeks overlapping the selected month. */
  queriesInMonth: number
  smsSentInMonth: number
  /** All-time standing on the cumulative escalation ladder. */
  totalQueries: number
  currentLevel: number // 0 = never flagged, else 1..3
  lastQueryWeek: string | null
  smsSentTotal: number
  smsFailedTotal: number
}

export interface LatenessLogEntry {
  id: string
  staffId: string
  fullName: string
  weekStart: string // Monday YYYY-MM-DD
  level: number
  lateCount: number
  createdAt: string
  smsStatus: LatenessSmsStatus
  smsSentAt: string | null
  smsRecipient: string | null
  smsMessage: string | null
  smsError: string | null
}

export interface LatenessLog {
  month: string
  history: 'month' | 'all'
  config: { latenessPolicyEnabled: boolean; lateFlagsPerWeek: number }
  rows: LatenessStaffRow[]
  entries: LatenessLogEntry[]
}

export async function getLatenessLog(month: string, history: 'month' | 'all' = 'month') {
  const res = await api.get<LatenessLog>(
    `/api/staff/attendance/lateness-log?month=${month}&history=${history}`
  )
  return { success: res.success, data: res.data, error: res.error }
}

export async function setAttendanceOverride(data: {
  staffId: string
  date: string
  clockIn?: string
  clockOut?: string
}) {
  return api.post<{ success: boolean }>('/api/staff/attendance/overrides', data)
}

export interface RawAttendanceEvent {
  id: string
  staffId: string | null
  staffName: string | null
  deviceUserId: string
  deviceUserName: string | null
  /** Raw device clock — drifts/resets on some readers. */
  eventTimestamp: string
  /** Clock time actually used for scoring — ingested time for webhook punches. */
  effectiveTimestamp: string
  deviceNo: string | null
  rawStatus: string | null
  sourceFile: string | null
  createdAt: string
}

export async function getRawAttendanceEvents() {
  const res = await api.get<RawAttendanceEvent[]>('/api/staff/attendance/raw-events')
  return { success: res.success, data: res.data ?? [], error: res.error }
}

// ── Attendance scoring config (clinic-wide, editable in Settings) ───────────
export interface AttendanceScoringConfig {
  saturdayExcluded: boolean
  /** Minutes from midnight (e.g. 495 = 08:15). */
  onTimeBy: number
  lateMildBy: number
  veryEarlyBy: number
  earlyBy: number
  baseDailyScore: number
  lateMildScore: number
  lateSevereScore: number
  noShowScore: number
  veryEarlyScore: number
  earlyScore: number
  /** Weekly lateness policy (Phase I). */
  latenessPolicyEnabled: boolean
  lateFlagsPerWeek: number
}

export function getAttendanceScoringConfig() {
  return api.get<AttendanceScoringConfig>('/api/staff/attendance/config')
}

export function saveAttendanceScoringConfig(config: AttendanceScoringConfig) {
  return api.put<AttendanceScoringConfig>('/api/staff/attendance/config', config)
}

// ── Staff timeline (aggregated activity feed) ───────────────────────────────
export type TimelineEventType =
  | 'attendance'
  | 'document'
  | 'training'
  | 'assessment'
  | 'request'
  | 'lifecycle'
  | 'task'
  | 'memo'

export interface TimelineEvent {
  id: string
  eventType: TimelineEventType
  title: string
  description: string | null
  timestamp: string
}

export interface StaffTimelinePage {
  events: TimelineEvent[]
  total: number
  hasMore: boolean
}

export function getStaffTimeline(staffId: string, opts?: { limit?: number; offset?: number }) {
  const params = new URLSearchParams()
  if (opts?.limit) params.set('limit', String(opts.limit))
  if (opts?.offset) params.set('offset', String(opts.offset))
  const qs = params.toString()
  return api.get<StaffTimelinePage>(`/api/staff-timeline/${staffId}${qs ? `?${qs}` : ''}`)
}

export interface RecentRequestRow {
  id: string
  requestType: string
  subType?: string | null
  status: 'pending' | 'approved' | 'rejected'
  submittedAt?: string | null
  createdAt?: string | null
  staff?: { fullName?: string | null; staffId?: string | null } | null
}

/** Latest staff requests across the clinic (dashboard widget). */
export async function getRecentRequests() {
  const res = await api.get<RecentRequestRow[]>('/api/staff/requests/all')
  return { success: res.success, data: res.data ?? [], error: res.error }
}
