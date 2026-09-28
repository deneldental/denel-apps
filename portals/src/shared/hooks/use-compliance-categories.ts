import {
  type ComplianceCategory,
  getComplianceCategories,
} from '@/lib/actions/compliance-categories'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'

/**
 * `/api/compliance-categories` returns the full list (active + inactive) —
 * there's no separate active-only endpoint, so both the Settings admin table
 * and the Compliance page's category picker read this same cache entry and
 * filter client-side as needed. A save in Settings invalidates this key
 * (`queryKeys.settings.lookup('compliance-categories')`), refreshing both.
 */
export const COMPLIANCE_CATEGORIES_KEY = queryKeys.settings.lookup('compliance-categories')

export function useComplianceCategories() {
  const query = useApiQuery(COMPLIANCE_CATEGORIES_KEY, getComplianceCategories, {
    staleTime: 60_000,
  })
  return {
    categories: query.data ?? ([] as ComplianceCategory[]),
    isLoading: query.isLoading,
    error: query.error ? query.error.message : null,
  }
}
