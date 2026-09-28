import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { api } from '@/lib/api-client'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'

/**
 * The one way a settings section reads and writes a `clinic_settings` key
 * (`GET`/`PUT /api/settings/kv/:key`).
 *
 * Why a hook instead of the `useEffect` + `api.get` each section used to have
 * (settings-domain-audit B5 / D3 / S6.3):
 *
 *   - A failed load used to be indistinguishable from "never saved": the form
 *     showed the defaults with Save enabled, and saving wrote those defaults
 *     over the real configuration. Here a failed load is `loadError`,
 *     `canSave` is false, and `save()` refuses.
 *   - Reads are cached under `queryKeys.settings.kv(key)` and a save
 *     invalidates it, so every other reader of the same key (the sidebar's
 *     `useModuleVisibility`, another section) refreshes without a reload.
 *
 * `value` is the editable draft. It is seeded from the stored value — merged
 * over `defaults` for plain objects, taken as-is otherwise, or through
 * `fromStored` when a key needs its own rule — whenever the server value
 * changes, and left alone while the user types.
 */
export interface KvSettingOptions<T> {
  /**
   * Turn what the server holds into the editable value. Receives `null` when
   * the key has never been saved. Default: `mergeStored(defaults, stored)`.
   */
  fromStored?: (stored: unknown) => T
}

export interface KvSetting<T> {
  value: T
  setValue: Dispatch<SetStateAction<T>>
  /** The value as last loaded (through `fromStored`); undefined until a load succeeds. */
  loaded: T | undefined
  loading: boolean
  loadError: string | null
  /** False while loading or after a failed load — saving then would overwrite the stored value with defaults. */
  canSave: boolean
  saving: boolean
  isDirty: boolean
  /** PUT `next` (or the current draft) and re-read. Rejects when `canSave` is false or the server refuses. */
  save: (next?: T) => Promise<void>
  refetch: () => void
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Default seeding rule: shallow-merge plain objects over the defaults; anything else as-is. */
export function mergeStored<T>(defaults: T, stored: unknown): T {
  if (stored === null || stored === undefined) return defaults
  if (isPlainObject(defaults) && isPlainObject(stored)) return { ...defaults, ...stored } as T
  return stored as T
}

export function useKvSetting<T>(
  key: string,
  defaults: T,
  options: KvSettingOptions<T> = {}
): KvSetting<T> {
  const query = useApiQuery(queryKeys.settings.kv(key), () =>
    api.get<unknown>(`/api/settings/kv/${key}`)
  )

  // `defaults` and `fromStored` are usually written inline by the caller, so
  // their identity changes every render. Read them through a ref so the seed
  // depends on the server value alone — otherwise every render would re-seed
  // the draft and wipe what the user is typing.
  const seedRef = useRef({ defaults, fromStored: options.fromStored })
  seedRef.current = { defaults, fromStored: options.fromStored }

  const loaded = useMemo<T | undefined>(() => {
    if (query.data === undefined) return undefined
    const { defaults: d, fromStored } = seedRef.current
    return fromStored ? fromStored(query.data) : mergeStored(d, query.data)
  }, [query.data])

  const [value, setValue] = useState<T>(defaults)
  useEffect(() => {
    if (loaded !== undefined) setValue(loaded)
  }, [loaded])

  const mutation = useApiMutation<void, T>(
    (next) => api.put<void>(`/api/settings/kv/${key}`, { value: next }),
    { invalidates: [queryKeys.settings.kv(key)] }
  )

  const loadError = query.isError ? query.error.message || 'Failed to load' : null
  const canSave = !query.isLoading && !query.isError
  const { mutateAsync } = mutation

  const save = useCallback(
    async (next?: T) => {
      if (!canSave) {
        throw new Error(
          'Settings not loaded — refusing to save, it would overwrite the stored value with defaults'
        )
      }
      await mutateAsync(next === undefined ? value : next)
    },
    [canSave, mutateAsync, value]
  )

  const { refetch: queryRefetch } = query
  const refetch = useCallback(() => {
    void queryRefetch()
  }, [queryRefetch])

  const isDirty = JSON.stringify(value) !== JSON.stringify(loaded === undefined ? defaults : loaded)

  return {
    value,
    setValue,
    loaded,
    loading: query.isLoading,
    loadError,
    canSave,
    saving: mutation.isPending,
    isDirty,
    save,
    refetch,
  }
}
