import { BarChart3, Boxes, Coffee, Package, Truck } from 'lucide-react'
import { api } from '@/lib/api-client'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { type MiniSidebarItem, MiniSidebarLayout } from '@/shared/components/mini-sidebar-layout'

const BASE_NAV: MiniSidebarItem[] = [
  { label: 'Clinic Inventory', to: '/inventory', icon: Package },
  { label: 'Product Inventory', to: '/inventory/products', icon: Boxes },
  { label: 'Suppliers', to: '/inventory/suppliers', icon: Truck },
  { label: 'Breakfast', to: '/inventory/breakfast', icon: Coffee, adminOnly: true },
]

const THRESHOLD_ITEM: MiniSidebarItem = {
  label: 'Monthly Threshold',
  to: '/inventory/monthly-threshold',
  icon: BarChart3,
}

// Clinic Inventory owns `/inventory` and any direct id route (`/inventory/:id`)
// but NOT the sibling pages. Default startsWith matching would otherwise mark
// Clinic Inventory active on /inventory/products, /inventory/suppliers, etc.
function matchActive(itemTo: string, currentPath: string): boolean {
  if (itemTo === '/inventory') {
    if (currentPath === '/inventory') return true
    if (currentPath.startsWith('/inventory/products')) return false
    if (currentPath.startsWith('/inventory/suppliers')) return false
    if (currentPath.startsWith('/inventory/monthly-threshold')) return false
    if (currentPath.startsWith('/inventory/breakfast')) return false
    return currentPath.startsWith('/inventory/')
  }
  return currentPath === itemTo || currentPath.startsWith(`${itemTo}/`)
}

export function InventoryLayout() {
  // Same cache key the Settings section writes, so a save there shows the
  // Monthly Threshold link without a reload (settings-domain-audit D3).
  const thresholdQuery = useApiQuery(
    queryKeys.settings.kv('monthly_threshold_config'),
    () => api.get<{ enabled: boolean } | null>('/api/settings/kv/monthly_threshold_config'),
    { staleTime: 60_000 }
  )
  const thresholdEnabled = thresholdQuery.data?.enabled ?? false

  const items = thresholdEnabled ? [...BASE_NAV, THRESHOLD_ITEM] : BASE_NAV

  return <MiniSidebarLayout title="Inventory" items={items} matchActive={matchActive} />
}
