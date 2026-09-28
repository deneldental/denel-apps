import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'

/**
 * RBAC hook mirroring the portal's `usePermissions`. Fetches the logged-in
 * staff user's permission bundle from `/api/auth/permissions` and exposes
 * `hasPermission(module, action)` + `canAccess(module)` for UI gating.
 *
 * Auto-bails to `null`/loading=false when no staff session exists (e.g. when
 * a patient is logged in — patient auth does not grant staff permissions).
 */

export type Permission = {
  module: string
  action: string
}

export type DynamicMenuItem = {
  module: string
  label: string
  href: string
  iconName: string
  children?: DynamicMenuItem[]
}

export type PermissionsData = {
  roleId: string
  roleName: string
  isAdmin: boolean
  /** Map of module → granted actions — matches the backend `/permissions` shape. */
  permissions: Record<string, string[]>
  menuItems: DynamicMenuItem[]
}

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

export function usePermissions(): UsePermissionsReturn {
  const [data, setData] = useState<PermissionsData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchPermissions = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      // Gate on the staff session (custom phone+OTP). Bails to null when none
      // exists (e.g. a patient is logged in, or signed out).
      const me = await api.get('/api/staff-auth/me', { suppressSessionExpiredHook: true })
      if (!me.success) {
        setData(null)
        return
      }

      const result = await api.get<PermissionsData>('/api/auth/permissions')
      if (result.success && result.data) {
        setData(result.data)
      } else {
        throw new Error(result.error || 'Unknown error')
      }
    } catch (err) {
      console.error('[usePermissions] Error:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch permissions')
      setData(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPermissions()
  }, [fetchPermissions])

  const hasPermission = useCallback(
    (module: string, action: string): boolean => {
      if (!data) return false
      if (data.isAdmin) return true
      return data.permissions[module]?.includes(action) ?? false
    },
    [data]
  )

  const canAccess = useCallback(
    (module: string): boolean => {
      return hasPermission(module, 'read')
    },
    [hasPermission]
  )

  return {
    permissions: data?.permissions ?? {},
    menuItems: data?.menuItems ?? [],
    isAdmin: data?.isAdmin ?? false,
    roleId: data?.roleId ?? null,
    isLoading,
    error,
    hasPermission,
    canAccess,
    refetch: fetchPermissions,
  }
}
