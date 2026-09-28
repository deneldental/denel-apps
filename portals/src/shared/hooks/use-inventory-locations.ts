import { getInventoryLocations, type InventoryLocation } from '@/lib/actions/inventory-locations'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'

/**
 * `/api/inventory-locations` returns the full list (active + inactive) — no
 * separate active-only endpoint. Shared by every inventory/restock/receive
 * sheet's location picker and the Settings admin table; a save in Settings
 * invalidates this key (`queryKeys.settings.lookup('inventory-locations')`),
 * refreshing every open picker.
 */
export const INVENTORY_LOCATIONS_KEY = queryKeys.settings.lookup('inventory-locations')

export function useInventoryLocations(opts: { enabled?: boolean } = {}) {
  const query = useApiQuery(INVENTORY_LOCATIONS_KEY, getInventoryLocations, {
    staleTime: 60_000,
    enabled: opts.enabled ?? true,
  })
  return {
    locations: query.data ?? ([] as InventoryLocation[]),
    isLoading: query.isLoading,
    error: query.error ? query.error.message : null,
  }
}
