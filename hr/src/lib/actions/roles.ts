import { api } from '@/lib/api-client'

// RBAC administration — roles, the role×module permission matrix, and bundles.
// Ported into HR from the portal's Access Management. All of `/api/roles/*` is
// admin-only on the backend (literal roleId === 'admin'), so the HR section is
// gated to admins; the calls succeed for them via the admin bypass.

export type Scope = 'portal' | 'pwa'
export type BundleScope = 'portal' | 'pwa' | 'all'

export interface RoleSummary {
  id: string
  name: string
  description: string | null
  isSystem: boolean
  scopes: string[]
  bundleCount: number
}

export interface RoleDetail {
  id: string
  name: string
  description: string | null
  isSystem: boolean
  bundles: Array<{ id: string; name: string; scope: BundleScope }>
  scopes: string[]
}

export interface Bundle {
  id: string
  name: string
  description: string | null
  scope: BundleScope
  isSystem: boolean
  parentBundleId: string | null
}

export interface PermissionRow {
  id: string
  module: string
  action: string
  description: string | null
}

export interface BundleDetail extends Bundle {
  permissions: PermissionRow[]
}

export interface MatrixPermission {
  id: string
  module: string
  action: string
  description: string | null
  granted: boolean
}

export interface MatrixResponse {
  roleId: string
  mode: 'matrix' | 'bundle' | 'inherited'
  scope: Scope
  permissions: MatrixPermission[]
}

// ── Roles ────────────────────────────────────────────────────────────────────

export const listRoles = () => api.get<RoleSummary[]>('/api/roles')
export const getRole = (id: string) => api.get<RoleDetail>(`/api/roles/${id}`)

export const createRole = (input: {
  name: string
  description?: string
  scopes?: string[]
  bundleIds?: string[]
}) => api.post<{ id: string }>('/api/roles', input)

export const updateRole = (id: string, patch: { name?: string; description?: string }) =>
  api.patch(`/api/roles/${id}`, patch)

export const deleteRole = (id: string) => api.delete(`/api/roles/${id}`)

export const setRoleBundles = (id: string, bundleIds: string[]) =>
  api.put(`/api/roles/${id}/bundles`, { bundleIds })

export const setRoleScopes = (id: string, scopes: string[]) =>
  api.put(`/api/roles/${id}/scopes`, { scopes })

// ── Permission matrix (role × module, per scope) ───────────────────────────────

export const getRolePermissions = (id: string, scope: Scope) =>
  api.get<MatrixResponse>(`/api/roles/${id}/permissions?scope=${scope}`)

/** Replace a role's matrix for a scope. `permissions` are "module:action" strings. */
export const setRolePermissions = (id: string, scope: Scope, permissions: string[]) =>
  api.put(`/api/roles/${id}/permissions?scope=${scope}`, { permissions })

// ── Bundles ────────────────────────────────────────────────────────────────────

export const listAllBundles = () => api.get<Bundle[]>('/api/roles/bundles/all')
export const getBundle = (id: string) => api.get<BundleDetail>(`/api/roles/bundles/${id}`)

export const createBundle = (input: {
  name: string
  description?: string
  scope: BundleScope
  permissionIds: string[]
}) => api.post<{ id: string }>('/api/roles/bundles', input)

export const updateBundle = (
  id: string,
  patch: {
    permissionIds?: string[]
    name?: string
    description?: string
    scope?: BundleScope
  }
) => api.patch(`/api/roles/bundles/${id}`, patch)

export const deleteBundle = (id: string) => api.delete(`/api/roles/bundles/${id}`)

/** Set/clear a bundle's parent (composition). Note: this route is /api/hr3. */
export const setBundleParent = (bundleId: string, parentBundleId: string | null) =>
  api.patch(`/api/hr3/bundles/${bundleId}/parent`, { parentBundleId })

/** All permission rows grouped for the bundle builder. */
export const listAllPermissions = () => api.get<PermissionRow[]>('/api/roles/permissions/all')
