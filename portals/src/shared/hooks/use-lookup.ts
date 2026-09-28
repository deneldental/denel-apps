import type { ApiResponse } from '@/lib/api-client'
import { api } from '@/lib/api-client'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'

/**
 * A row from any `/api/lookups/:type` list (payment methods, appointment types,
 * units, categories, tags, …). Every lookup shares this base shape; a given
 * type may carry extra columns (`kind`, `glAccountCode`, …) which pass through
 * untouched — read them with a local cast at the call site that needs them.
 */
export type LookupRow = {
  id: string
  name: string
  displayName: string | null
  colour: string | null
  isActive: boolean
}

type RawLookupRow = {
  id: string | number
  name: string
  displayName?: string | null
  colour?: string | null
  isActive?: boolean
  [key: string]: unknown
}

function normalise(rows: RawLookupRow[] | null | undefined): LookupRow[] {
  return (rows ?? []).map((r) => ({
    ...r,
    id: String(r.id),
    name: String(r.name),
    displayName: r.displayName ?? null,
    colour: r.colour ?? null,
    isActive: r.isActive ?? true,
  }))
}

type UseLookupOptions = {
  /**
   * Hit `/api/lookups/:type/all` (active + inactive) instead of the default
   * active-only endpoint. Settings tables want this; pickers do not.
   */
  includeInactive?: boolean
  /** Skip the fetch until true — e.g. gate on a dialog being open. */
  enabled?: boolean
}

type UseLookupReturn = {
  rows: LookupRow[]
  isLoading: boolean
  error: string | null
}

/**
 * Read a `/api/lookups/:type` list through TanStack Query. Every picker that
 * needs the same lookup shares one fetch, and they all refresh together when
 * the matching Settings section invalidates
 * `queryKeys.settings.lookup(type)` on save — no page reload.
 *
 * The active-only and `includeInactive` variants cache under keys that share
 * the `['settings','lookup',type]` prefix, so one `invalidateQueries` on that
 * prefix refreshes both.
 */
export function useLookup(type: string, opts: UseLookupOptions = {}): UseLookupReturn {
  const { includeInactive = false, enabled = true } = opts
  const queryKey = includeInactive
    ? [...queryKeys.settings.lookup(type), 'all']
    : queryKeys.settings.lookup(type)

  const query = useApiQuery(
    queryKey,
    () => api.get<RawLookupRow[]>(`/api/lookups/${type}${includeInactive ? '/all' : ''}`),
    {
      select: normalise,
      staleTime: 5 * 60_000, // reference data — dedupe the many pickers
      enabled,
    }
  )

  return {
    rows: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error ? query.error.message : null,
  }
}

type LookupAdminActions<TCreate, TUpdate> = {
  /** The `/all` fetcher (active + inactive) — e.g. `getAllUnits`. */
  getAll: () => Promise<ApiResponse<RawLookupRow[]>>
  create: (data: TCreate) => Promise<ApiResponse<unknown>>
  update: (id: string, data: TUpdate) => Promise<ApiResponse<unknown>>
  remove: (id: string) => Promise<ApiResponse<unknown>>
}

/**
 * Admin CRUD for one `/api/lookups/:type`, for its Settings section. Returns the
 * full list (incl. inactive) plus `create` / `update` / `remove` mutations that
 * each invalidate `queryKeys.settings.lookup(type)` on success — which by
 * TanStack prefix-match refreshes this table *and* every `useLookup(type)`
 * picker elsewhere in the app, with no page reload.
 *
 * `update` takes `{ id, data }` as its single mutate variable. `TRow` widens the
 * returned row type for lookups with extra columns (`pettyRefType`, `kind`, …):
 * `normalise` spreads every raw field through, so those are present at runtime.
 */
export function useLookupAdmin<TCreate, TUpdate = TCreate, TRow extends LookupRow = LookupRow>(
  type: string,
  actions: LookupAdminActions<TCreate, TUpdate>
) {
  const invalidates = [queryKeys.settings.lookup(type)]

  const listQuery = useApiQuery([...queryKeys.settings.lookup(type), 'all'], actions.getAll, {
    select: normalise as (rows: RawLookupRow[] | null | undefined) => TRow[],
    staleTime: 30_000,
  })

  const create = useApiMutation(actions.create, { invalidates })
  const update = useApiMutation(
    (vars: { id: string; data: TUpdate }) => actions.update(vars.id, vars.data),
    { invalidates }
  )
  const remove = useApiMutation((id: string) => actions.remove(id), { invalidates })

  return {
    rows: (listQuery.data ?? []) as TRow[],
    isLoading: listQuery.isLoading,
    error: listQuery.error ? listQuery.error.message : null,
    create,
    update,
    remove,
  }
}
