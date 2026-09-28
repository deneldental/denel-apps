import { api } from '@/lib/api-client'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'

type Visibility = Record<string, boolean>

/**
 * The set of module ids the admin has hidden from navigation, from
 * `settings/kv/module_visibility`. Shared by the desktop sidebar and the
 * mobile drawer so they show the same thing off one fetch, and cached under
 * `queryKeys.settings.kv('module_visibility')` — the Settings section
 * invalidates that key on toggle, so the nav updates without a reload.
 *
 * A module is hidden only when its flag is explicitly `false`; anything else
 * (missing key, missing flag) means visible.
 */
const EMPTY_SET = new Set<string>()

export function useModuleVisibility(): { hiddenIds: Set<string>; isLoading: boolean } {
  const query = useApiQuery(
    queryKeys.settings.kv('module_visibility'),
    () => api.get<Visibility | null>('/api/settings/kv/module_visibility'),
    {
      staleTime: 5 * 60_000,
      select: (data): Set<string> => {
        const hidden = new Set<string>()
        for (const [id, visible] of Object.entries(data ?? {})) {
          if (visible === false) hidden.add(id)
        }
        return hidden
      },
    }
  )

  return { hiddenIds: query.data ?? EMPTY_SET, isLoading: query.isLoading }
}
