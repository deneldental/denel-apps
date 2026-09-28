import { type CrmAutomationPolicies, normalizeCrmPolicies } from '@denel/utils'
import { api } from '@/lib/api-client'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'

export const CRM_POLICIES_KEY = 'crm:automation_policies'

/**
 * Read-only view of Settings → CRM → Automations, cached under the key the
 * section writes so a save refreshes every reader (settings-domain-audit S5-B).
 */
export function useCrmPolicies(opts: { enabled?: boolean } = {}) {
  const query = useApiQuery(
    queryKeys.settings.kv(CRM_POLICIES_KEY),
    () => api.get<unknown>(`/api/settings/kv/${CRM_POLICIES_KEY}`),
    { staleTime: 60_000, enabled: opts.enabled ?? true }
  )
  const policies: CrmAutomationPolicies = normalizeCrmPolicies(query.data)
  return { policies, isLoading: query.isLoading }
}
