import { api } from '@/lib/api-client'

// HR-side actions for staff self-registration (generate link, review, approve,
// reject). The public side (the register form itself) lives in the Team app.

export interface RegistrationInviteSummary {
  id: string
  status: string
  note: string | null
  fullName: string | null
  phone: string | null
  title: string | null
  department: string | null
  phoneVerified: boolean
  cvUrl: string | null
  staffId: string | null
  reviewNotes: string | null
  expiresAt: string
  submittedAt: string | null
  createdAt: string
}

export interface RegistrationInviteDetail {
  id: string
  status: string
  note: string | null
  // biome-ignore lint/suspicious/noExplicitAny: free-form submitted payload
  submittedData: Record<string, any>
  verifiedPhone: string | null
  phoneVerified: boolean
  cvUrl: string | null
  staffId: string | null
  reviewNotes: string | null
  expiresAt: string
  submittedAt: string | null
  createdAt: string
}

export interface ApproveAdminFields {
  staffType?: 'internal' | 'external'
  deviceUserId?: string
  positionTag?: 'staff' | 'non_staff'
  isClinicalPractitioner?: boolean
  receivesCommission?: boolean
  hasPayslip?: boolean
  tracksAttendance?: boolean
  requiresLicense?: boolean
  salaryBand?: string
  role?: string
  scopes?: string[]
  /** Required when the role signs in to the portal or HR app (e-mail + password). */
  initialPassword?: string
}

/** Generate a one-time 24h invite link. Returns { path } to prefix with the Team origin. */
export function generateInvite(note?: string) {
  return api.post<{ id: string; token: string; path: string; expiresAt: string }>(
    '/api/staff-registration/invites',
    { note }
  )
}

export function listInvites(status?: string) {
  return api.get<RegistrationInviteSummary[]>(
    `/api/staff-registration/invites${status ? `?status=${encodeURIComponent(status)}` : ''}`
  )
}

export function getInvite(id: string) {
  return api.get<RegistrationInviteDetail>(`/api/staff-registration/invites/${id}`)
}

export function approveInvite(id: string, admin: ApproveAdminFields) {
  return api.post<{ generatedStaffId: string; message: string }>(
    `/api/staff-registration/invites/${id}/approve`,
    admin
  )
}

export function rejectInvite(id: string, reason?: string) {
  return api.post(`/api/staff-registration/invites/${id}/reject`, { reason })
}

export function deleteInvite(id: string) {
  return api.delete(`/api/staff-registration/invites/${id}`)
}
