import { useCallback } from 'react'
import {
  type DynamicMenuItem,
  type PermissionsData,
  useAuthPermissions,
} from './use-auth-permissions'

export type { DynamicMenuItem, PermissionsData }

type UsePermissionsReturn = {
  permissions: Record<string, string[]>
  menuItems: DynamicMenuItem[]
  isAdmin: boolean
  roleId: string | null
  isLoading: boolean
  error: string | null
  hasPermission: (module: string, action: string) => boolean
  canAccess: (module: string) => boolean
  refetch: () => Promise<void>
}

/**
 * Permission helpers for the current user. Backed by the shared, cached
 * `useAuthPermissions` query — so mounting this on several pages no longer
 * triggers a getSession + permissions round-trip each time; the payload is
 * fetched once per session and reused. Public API is unchanged.
 */
export function usePermissions(): UsePermissionsReturn {
  const { data, isLoading, error, refetch } = useAuthPermissions()

  const hasPermission = useCallback(
    (module: string, action: string): boolean => {
      if (!data) return false
      if (data.isAdmin) return true
      return data.permissions[module]?.includes(action) ?? false
    },
    [data]
  )

  const canAccess = useCallback(
    (module: string): boolean => hasPermission(module, 'read'),
    [hasPermission]
  )

  return {
    permissions: data?.permissions ?? {},
    menuItems: data?.menuItems ?? [],
    isAdmin: data?.isAdmin ?? false,
    roleId: data?.roleId ?? null,
    isLoading,
    error: error ? (error instanceof Error ? error.message : 'Failed to fetch permissions') : null,
    hasPermission,
    canAccess,
    refetch: async () => {
      await refetch()
    },
  }
}
