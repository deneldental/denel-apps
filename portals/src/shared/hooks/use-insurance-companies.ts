import { useQuery } from '@tanstack/react-query'
import { getInsuranceCompanies, type InsuranceCompany } from '@/lib/actions/insurance'
import { queryKeys } from '@/lib/query-keys'

/**
 * Insurers are slow-moving reference data — a clinic adds one every few months.
 * A long staleTime means the many pickers that need the list (patient add/edit
 * sheets, the insurance-claim sheet) share a single fetch instead of firing one
 * request each on mount. Before this hook, the patients table alone fired
 * ~32 `/api/insurance/companies` requests to draw one 25-row page.
 */
const STALE_TIME_MS = 30 * 60_000 // 30 min
const GC_TIME_MS = 60 * 60_000 // 1 h — outlives navigation away and back

export type UseInsuranceCompaniesResult = {
  /** Always an array — `[]` while loading or on failure. */
  companies: InsuranceCompany[]
  isLoading: boolean
  isError: boolean
  refetch: () => void
}

/**
 * Shared, deduped read of the insurance-company list.
 *
 * @param enabled pass `open` from a dialog/sheet to skip the fetch entirely
 *                until the surface is actually shown. Defaults to `true`.
 */
export function useInsuranceCompanies(enabled = true): UseInsuranceCompaniesResult {
  const query = useQuery({
    queryKey: queryKeys.insurance.companies(),
    queryFn: async (): Promise<InsuranceCompany[]> => {
      const res = await getInsuranceCompanies()
      if (!res.success || !res.data) {
        throw new Error(res.error || 'Failed to load insurance companies')
      }
      return res.data
    },
    enabled,
    staleTime: STALE_TIME_MS,
    gcTime: GC_TIME_MS,
  })

  return {
    companies: query.data ?? [],
    // `isLoading` is false while disabled, which is what callers want.
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => {
      void query.refetch()
    },
  }
}
