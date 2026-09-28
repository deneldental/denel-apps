import { useQuery } from '@tanstack/react-query'
import { getHrFeatures, type HrFeatures } from '@/lib/actions/access-management'
import { usePermissions } from '@/shared/hooks/use-permissions'
import { HR_NAV, type NavItem } from './nav'

/**
 * The HR_NAV filtered by the clinic's feature flags + role. Items tagged with a
 * `feature` (Roster / Org Chart / Review Cycles) only appear when that flag is
 * enabled in Settings → Features; items tagged `adminOnly` (Access Management)
 * only appear for the Admin role. While flags/permissions load, gated items are
 * hidden (so a disabled item never flashes in before disappearing).
 */
export function useVisibleNav(): NavItem[] {
  const { isAdmin, hasPermission } = usePermissions()
  // React Query, mirroring usePermissions' useAuthPermissions — Sidebar (mounted
  // once) and MobileNav (unmounted/remounted on every drawer open) previously
  // each fired their own independent, uncached request.
  const { data: features } = useQuery<HrFeatures>({
    queryKey: ['hr-features'],
    staleTime: 60_000,
    queryFn: async () => {
      const res = await getHrFeatures()
      if (!res.success || !res.data) throw new Error(res.error ?? 'Failed to fetch HR features')
      return res.data
    },
  })

  return HR_NAV.filter((item) => {
    if (item.feature && !(features ? features[item.feature] : false)) return false
    if (item.adminOnly && !isAdmin) return false
    if (item.module && !isAdmin && !hasPermission(item.module, 'read')) return false
    return true
  })
}
