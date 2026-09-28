import { API_BASE_URL, api } from '@/lib/api-client'
import type { staff, staffDocuments } from '@/lib/db/schema'

export async function getStaff() {
  const res = await api.get<any[]>('/api/staff')
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
  const res = await api.get<any>(`/api/staff/${id}`)
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

export type LeaveBalance = {
  staffId: string
  year: number
  entitlement: number
  used: number
  remaining: number
  source: 'override' | 'clinic_default'
  breakdown: Array<{
    requestId: string
    startDate: string | null
    endDate: string | null
    days: number
  }>
}

export async function getStaffLeaveBalance(staffId: string, year?: number) {
  const qs = year ? `?year=${year}` : ''
  return api.get<LeaveBalance>(`/api/staff/leave-balance/${staffId}${qs}`)
}

export async function createLeaveRequestForStaff(input: {
  staffId: string
  startDate: string
  endDate: string
  reason?: string
  subType?: string
}) {
  return api.post<{ id: string }>('/api/staff/leave-requests', input)
}

export async function createStaff(data: any) {
  const res = await api.post<any>('/api/staff', data)
  return res
}

export async function updateStaff(id: string, data: Partial<typeof staff.$inferInsert>) {
  const res = await api.patch<any>(`/api/staff/${id}`, data)
  return res
}

export async function deleteStaff(id: string) {
  const res = await api.delete<any>(`/api/staff/${id}`)
  return res
}

/** Admin resets a staff member's sign-in password. Forces change on next login. */
export async function resetStaffPassword(staffId: string, newPassword: string) {
  return api.post<{ success: boolean; message?: string }>(`/api/staff/${staffId}/reset-password`, {
    newPassword,
  })
}

export async function getStaffDocuments(staffId: string) {
  const res = await api.get<any[]>(`/api/staff/${staffId}/documents`)
  return res.data || []
}

export async function addStaffDocument(data: typeof staffDocuments.$inferInsert) {
  const res = await api.post<any>('/api/staff/documents', data)
  return res
}

export async function updateStaffDocument(
  id: string,
  data: Partial<typeof staffDocuments.$inferInsert>
) {
  const res = await api.patch<any>(`/api/staff/documents/${id}`, data)
  return res
}

export async function deleteStaffDocument(id: string) {
  const res = await api.delete<any>(`/api/staff/documents/${id}`)
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
  status: 'present' | 'late' | 'absent' | 'excused' | 'off' | 'holiday'
  dailyScore: number
  isScoringDay: boolean
  isNoShow: boolean
  exceptionReason?: string | null
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
  const res = await fetch(url, { credentials: 'include' })
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

export async function upsertHoliday(date: string, name: string) {
  return api.post<HolidayRow>('/api/staff/holidays', { date, name })
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

export interface RawAttendanceEvent {
  id: string
  staffId: string | null
  staffName: string | null
  deviceUserId: string
  deviceUserName: string | null
  eventTimestamp: string
  deviceNo: string | null
  rawStatus: string | null
  sourceFile: string | null
  createdAt: string
}

export async function getRawAttendanceEvents() {
  const res = await api.get<RawAttendanceEvent[]>('/api/staff/attendance/raw-events')
  return { success: res.success, data: res.data ?? [], error: res.error }
}
