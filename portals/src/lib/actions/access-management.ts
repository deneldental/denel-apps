import { api } from '@/lib/api-client'

export type OffboardResult = {
  userId: string
  offboarded: boolean
  staffSoftDeleted: boolean
}

/**
 * One-click offboard. Unsets role, revokes both scopes, bans the user, and
 * soft-deletes the staff record in one transaction. Reason is required and
 * captured on the audit log.
 */
export async function offboardStaff(userId: string, reason: string) {
  return api.post<OffboardResult>(`/api/access-management/staff/${userId}/offboard`, { reason })
}

export type BulkRoleResult = { updated: number; role: string | null }

/** Apply the same role to up to 100 users in one transaction. */
export async function bulkAssignRole(userIds: string[], role: string | null) {
  return api.post<BulkRoleResult>('/api/access-management/staff/bulk-role', { userIds, role })
}

export type WhoCanDoResult = {
  module: string
  action: string
  viaRoles: string[]
  users: Array<{
    id: string
    name: string
    email: string
    roleId: string | null
    banned: boolean
  }>
  adminBypass: boolean
}

/** Reverse lookup — which users hold (module, action)? Surfaces admin bypass. */
export async function whoCanDo(moduleName: string, action: string) {
  const qs = new URLSearchParams({ module: moduleName, action }).toString()
  return api.get<WhoCanDoResult>(`/api/access-management/who-can?${qs}`)
}

export type UserPermissions = {
  user: {
    id: string
    name: string
    email: string
    roleId: string | null
    role: string | null
    banned: boolean
  }
  adminBypass: boolean
  bundles: Array<{ id: string; name: string; scope: string; isSystem: boolean }>
  permissions: Array<{ module: string; action: string }>
  /** PR-5 — portal + PWA scope toggles, surfaced inline so the staff detail
   *  Permissions tab renders everything in one round-trip. */
  scopes: { portal: boolean; pwa: boolean }
}

/** "What can user Y do?" — flat permission list + bundle list for the user. */
export async function getUserPermissions(userId: string) {
  return api.get<UserPermissions>(`/api/access-management/users/${userId}/permissions`)
}

// ── Patient PWA management (Phase 5B) ────────────────────────────────────

export type PatientPwaRow = {
  id: string
  name: string
  patientId: string | null
  phone: string | null
  email: string | null
  pwaAccessGrantedAt: string | null
  grantedBy: { id: string; name: string | null } | null
  activeSessionCount: number
  lastSession: { userAgent: string | null; ipAddress: string | null; lastUsedAt: string } | null
}

export type PatientPwaList = {
  rows: PatientPwaRow[]
  total: number
  page: number
  limit: number
}

export async function listPatientPwa(
  opts: { search?: string; page?: number; limit?: number } = {}
) {
  const qs = new URLSearchParams()
  if (opts.search) qs.set('search', opts.search)
  if (opts.page) qs.set('page', String(opts.page))
  if (opts.limit) qs.set('limit', String(opts.limit))
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  return api.get<PatientPwaList>(`/api/access-management/patients${suffix}`)
}

export type PatientSession = {
  id: string
  userAgent: string | null
  ipAddress: string | null
  lastUsedAt: string
  createdAt: string
  expiresAt: string
}

export async function listPatientSessions(patientId: string) {
  return api.get<PatientSession[]>(`/api/access-management/patients/${patientId}/sessions`)
}

export async function revokePatientPwa(patientId: string, reason?: string) {
  return api.post<{ id: string; killedSessions: number }>(
    `/api/access-management/patients/${patientId}/revoke-pwa`,
    { reason: reason ?? null }
  )
}

export async function revokePatientSessions(patientId: string) {
  return api.post<{ id: string; killedSessions: number }>(
    `/api/access-management/patients/${patientId}/revoke-sessions`,
    {}
  )
}

export async function deletePatientSession(sessionId: string) {
  return api.delete<{ success: true }>(`/api/access-management/patient-sessions/${sessionId}`)
}

// ── HR feature flags (Phase 5B + PR-18) ─────────────────────────────────

export type HrFeatures = {
  rosterEnabled: boolean
  orgChartEnabled: boolean
  reviewCyclesEnabled: boolean
}

export async function getHrFeatures() {
  return api.get<HrFeatures>(`/api/settings/hr-features`)
}

export type HrFeatureKey = 'hr:roster_enabled' | 'hr:org_chart_enabled' | 'hr:review_cycles_enabled'

export async function setHrFeatureFlag(key: HrFeatureKey, value: boolean) {
  return api.put<{ success: true }>(`/api/settings/kv/${encodeURIComponent(key)}`, { value })
}

// ─── User bundles (PR-11) ───────────────────────────────────────────────────

export type AvailableBundle = {
  id: string
  name: string
  description: string | null
  scope: 'portal' | 'pwa' | 'all'
  isSystem: boolean
}

export type UserBundleGrant = {
  bundleId: string
  bundleName: string
  scope: 'portal' | 'pwa' | 'all'
  grantSource: 'manual' | 'auto_position_tag'
  grantedAt: string
}

/** All bundles in the system that can be assigned to a user. */
export async function listAvailableBundles() {
  return api.get<AvailableBundle[]>('/api/access-management/bundles')
}

/** Direct grants attached to a user via `user_bundles` (not role-inherited). */
export async function listUserBundles(userId: string) {
  return api.get<UserBundleGrant[]>(`/api/access-management/users/${userId}/bundles`)
}

/** Manually grant a bundle to a user. */
export async function grantUserBundle(userId: string, bundleId: string) {
  return api.post<{ success: true }>(`/api/access-management/users/${userId}/bundles`, {
    bundleId,
  })
}

/** Revoke a bundle grant from a user. Removes both manual and auto rows. */
export async function revokeUserBundle(userId: string, bundleId: string) {
  return api.delete<{ success: true }>(`/api/access-management/users/${userId}/bundles/${bundleId}`)
}
