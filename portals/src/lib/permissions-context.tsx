import { createContext, useContext } from 'react'

export type PermissionsPayload = {
  roleId?: string | null
  isAdmin: boolean
  scopes: string[]
  accessibleModules: string[]
  /**
   * Resolved module → actions map from `/api/auth/permissions`, already expanded
   * with the module hierarchy by the backend (e.g. `patients:update` implies
   * `xrays:update`). Use `useCan()` rather than reading this directly.
   */
  permissions?: Record<string, string[]>
}

const PermissionsContext = createContext<PermissionsPayload | null>(null)

export const PermissionsProvider = PermissionsContext.Provider

export function usePermissions(): PermissionsPayload | null {
  return useContext(PermissionsContext)
}

/**
 * Can the current user perform `action` on `module`?
 *
 * This mirrors the backend's `PermissionEngine.check()` decision, so UI gating
 * matches what the API will actually allow. Prefer this over role comparisons
 * (`roleId === 'doctor'`) — roles are configurable, permissions are the contract.
 *
 * Fails closed: while the payload is still loading, or if it failed to load,
 * this returns false.
 */
export function useCan(module: string, action: string): boolean {
  const payload = usePermissions()
  if (!payload) return false
  if (payload.isAdmin) return true
  return payload.permissions?.[module]?.includes(action) ?? false
}
