import {
  INVENTORY_POLICIES_KEY,
  type InventoryPolicies,
  mergeInventoryPolicies,
} from '@/features/inventory/policies'
import { api } from '@/lib/api-client'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'

/**
 * Read-only view of Settings → Inventory → Store Policies. Cached under the
 * same key the settings section writes, so a save there refreshes every
 * reader (settings-domain-audit S5-B).
 */
export function useInventoryPolicies(opts: { enabled?: boolean } = {}) {
  const query = useApiQuery(
    queryKeys.settings.kv(INVENTORY_POLICIES_KEY),
    () => api.get<unknown>(`/api/settings/kv/${INVENTORY_POLICIES_KEY}`),
    { staleTime: 60_000, enabled: opts.enabled ?? true }
  )
  const policies: InventoryPolicies = mergeInventoryPolicies(query.data)
  return { policies, isLoading: query.isLoading }
}
