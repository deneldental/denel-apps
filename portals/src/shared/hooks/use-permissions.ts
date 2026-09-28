import { useCallback, useEffect, useState } from 'react'
import { authClient } from '@/lib/auth-client'

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
  permissions: Record<string, string[]>
  menuItems: DynamicMenuItem[]
}

type UsePermissionsReturn = {
  permissions: Record<string, string[]>
  menuItems: DynamicMenuItem[]
  isAdmin: boolean
  roleId: string | null
  roleName: string | null
  isLoading: boolean
  error: string | null
  hasPermission: (module: string, action: string) => boolean
  canAccess: (module: string) => boolean
  refetch: () => Promise<void>
}

const API_URL = import.meta.env.VITE_API_URL

export function usePermissions(): UsePermissionsReturn {
  const [data, setData] = useState<PermissionsData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchPermissions = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      const { data: session } = await authClient.getSession()
      if (!session?.user) {
        setData(null)
        return
      }

      const response = await fetch(`${API_URL}/api/auth/permissions`, {
        credentials: 'include',
        headers: {
          'X-App-Id': 'portal',
        },
      })

      if (!response.ok) {
        throw new Error('Failed to fetch permissions')
      }

      const result = await response.json()
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

  // Re-fetch when the tab becomes visible again — catches role changes made
  // by an admin while this tab was in the background.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchPermissions()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [fetchPermissions])

  const hasPermission = useCallback(
    (module: string, action: string): boolean => {
      if (!data) return false
      if (data.isAdmin) return true
      const actions = data.permissions[module]
      return Array.isArray(actions) && actions.includes(action)
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
    roleName: data?.roleName ?? null,
    isLoading,
    error,
    hasPermission,
    canAccess,
    refetch: fetchPermissions,
  }
}
