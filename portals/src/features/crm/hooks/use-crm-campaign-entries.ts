import type { CampaignEntry } from '@/lib/actions/crm'
import type { ApiResponse } from '@/lib/api-client'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'

/**
 * Shared read for the CRM "campaign" pages (Recare, Birthdays, Follow-ups) —
 * each is a `<CampaignPageShell>` fed by one `/api/crm/:campaign` list. Puts
 * them on TanStack Query so a tab left open all day refreshes on refocus
 * (Phase 0 default) instead of showing whatever loaded this morning.
 */
export function useCrmCampaignEntries(
  campaign: string,
  fetcher: () => Promise<ApiResponse<CampaignEntry[]>>
) {
  const query = useApiQuery(queryKeys.crmCampaigns.entries(campaign), fetcher, {
    staleTime: 60_000,
  })
  return { entries: query.data ?? [], loading: query.isLoading }
}
