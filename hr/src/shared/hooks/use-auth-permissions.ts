import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'

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
  scopes: string[]
  /**
   * Module → granted actions, as returned by `/api/auth/permissions`
   * (`groupPermissionsByModule`). NOT an array of `{module, action}` pairs —
   * typing it that way made `hasPermission` call `.some()` on an object, which
   * threw for every non-admin (admin short-circuits before the lookup).
   */
  permissions: Record<string, string[]>
  menuItems: DynamicMenuItem[]
}

export const AUTH_PERMISSIONS_QUERY_KEY = ['auth', 'permissions'] as const

/**
 * Single source of truth for the `/api/auth/permissions` payload.
 *
 * Previously every consumer of `usePermissions` fetched this independently —
 * and each fetch first did its own `getSession()` round-trip — so navigating
 * between permission-gated pages re-hit the (remote, in dev) database twice per
 * page. Sharing one React Query keyed on the session collapses that to a single
 * cached fetch: the gate is derived from the auth context (no extra
 * `getSession`), and the result is reused everywhere until it goes stale.
 */
export function useAuthPermissions() {
  const { user } = useAuth()
  return useQuery<PermissionsData>({
    queryKey: AUTH_PERMISSIONS_QUERY_KEY,
    // Only fetch once the auth context has a session; no separate getSession.
    enabled: !!user,
    staleTime: 60_000,
    // Re-fetch when the tab regains focus so an admin's role change to this
    // user lands without a manual reload (mirrors the old visibility listener).
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const res = await api.get<PermissionsData>('/api/auth/permissions')
      if (!res.success || !res.data) {
        throw new Error(res.error ?? 'Failed to fetch permissions')
      }
      return res.data
    },
  })
}
