import { formatTooth, TOOTH_NOTATION_LABELS, type ToothNotation } from '@denel/utils'
import { useCallback } from 'react'
import {
  CHARTING_KEY,
  type ChartingPreferences,
  mergeChartingPreferences,
  mergePerioThresholds,
  PERIO_KEY,
  type PerioThresholds,
} from '@/features/clinical/preferences'
import { api } from '@/lib/api-client'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'

/**
 * Read-only view of Settings → Clinical → Charting Preferences, cached under
 * the keys the section writes so a save refreshes every reader
 * (settings-domain-audit S5-B).
 */
export function useClinicalPreferences(opts: { enabled?: boolean } = {}) {
  const enabled = opts.enabled ?? true
  const chartingQuery = useApiQuery(
    queryKeys.settings.kv(CHARTING_KEY),
    () => api.get<unknown>(`/api/settings/kv/${CHARTING_KEY}`),
    { staleTime: 60_000, enabled }
  )
  const perioQuery = useApiQuery(
    queryKeys.settings.kv(PERIO_KEY),
    () => api.get<unknown>(`/api/settings/kv/${PERIO_KEY}`),
    { staleTime: 60_000, enabled }
  )
  const charting: ChartingPreferences = mergeChartingPreferences(chartingQuery.data)
  const perio: PerioThresholds = mergePerioThresholds(perioQuery.data)
  return { charting, perio, isLoading: chartingQuery.isLoading || perioQuery.isLoading }
}

/** The configured tooth notation plus a stable formatter for stored FDI numbers. */
export function useToothNotation() {
  const { charting } = useClinicalPreferences()
  const notation: ToothNotation = charting.notationSystem
  const toothLabel = useCallback(
    (tooth: number | string | null | undefined) => formatTooth(tooth, notation),
    [notation]
  )
  return { notation, notationLabel: TOOTH_NOTATION_LABELS[notation], toothLabel }
}
