/**
 * TanStack Query glue for the portal's `lib/actions/*` layer.
 *
 * Every action returns `ApiResponse<T> = { success, data?, error? }`. These two
 * hooks unwrap that shape so features can move off the manual
 * `useEffect` + `useState` + `loadX()` pattern with almost no ceremony:
 *
 *   // read
 *   const { data: patients = [], isLoading } = useApiQuery(
 *     queryKeys.patients.list(filters),
 *     () => getPatients(filters),
 *   )
 *
 *   // write — invalidate every resource the mutation touches, cross-resource
 *   // included. This is what makes other screens refresh without an F5.
 *   const create = useApiMutation(createPatient, {
 *     invalidates: [queryKeys.patients.all, queryKeys.patientTags.all],
 *     onSuccess: () => toast.success('Patient created'),
 *   })
 *   // ... create.mutate(payload)
 *
 * Refresh behaviour (staleTime, refetchOnWindowFocus, …) is set once on the
 * shared QueryClient in `app/providers.tsx`; override per-call via `options`.
 */
import {
  type QueryKey,
  type UseMutationOptions,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type { ApiResponse } from '@/lib/api-client'

/**
 * Turn a read `ApiResponse<T>` into `T`, or throw so TanStack marks the query
 * errored. A query that came back with no `data` is a bug, so this is strict.
 */
function unwrapQuery<T>(res: ApiResponse<T>): T {
  if (!res.success) throw new Error(res.error || 'Failed to load')
  if (res.data === undefined) {
    throw new Error(
      'Response had no `data` — useApiQuery expects it. Use a plain action call for void endpoints.'
    )
  }
  return res.data
}

/**
 * Turn a write `ApiResponse<T>` into `T`, or throw on failure. Unlike reads,
 * a mutation may legitimately answer with a bare `{ success: true }` and no
 * `data` (most PATCH/DELETE endpoints here do). Those callers type `TData` as
 * `void`; the resolved value is simply `undefined`.
 */
function unwrapMutation<T>(res: ApiResponse<T>): T {
  if (!res.success) throw new Error(res.error || 'Failed to save')
  return res.data as T
}

/**
 * `useQuery` over a `lib/actions` fetcher. Pass a stable key from `queryKeys`.
 * `options` forwards everything TanStack accepts except `queryKey` / `queryFn`
 * (`enabled`, a longer `staleTime` for reference data, …). `select` may narrow
 * or reshape the result — `TSelected` is inferred from its return type.
 */
export function useApiQuery<T, TSelected = T>(
  queryKey: QueryKey,
  fetcher: () => Promise<ApiResponse<T>>,
  options?: Omit<UseQueryOptions<T, Error, TSelected, QueryKey>, 'queryKey' | 'queryFn'>
): UseQueryResult<TSelected, Error> {
  return useQuery<T, Error, TSelected, QueryKey>({
    queryKey,
    queryFn: async () => unwrapQuery(await fetcher()),
    ...options,
  })
}

type ApiMutationOptions<TData, TVars> = Omit<
  UseMutationOptions<TData, Error, TVars>,
  'mutationFn'
> & {
  /**
   * Query keys to invalidate on success. Give an array, or a function of the
   * result + variables when the keys depend on ids. Invalidate the broadest
   * key that's still correct (`queryKeys.x.all`) unless the churn is large.
   */
  invalidates?: QueryKey[] | ((data: TData, vars: TVars) => QueryKey[])
}

/**
 * `useMutation` over a `lib/actions` mutator. On success it invalidates the
 * `invalidates` keys before running any `onSuccess` you pass, so dependent
 * `useApiQuery`s refetch on their own.
 */
export function useApiMutation<TData, TVars = void>(
  mutationFn: (vars: TVars) => Promise<ApiResponse<TData>>,
  { invalidates, onSuccess, ...rest }: ApiMutationOptions<TData, TVars> = {}
): UseMutationResult<TData, Error, TVars> {
  const queryClient = useQueryClient()
  return useMutation<TData, Error, TVars>({
    ...rest,
    mutationFn: async (vars) => unwrapMutation(await mutationFn(vars)),
    // `...args` (not a fixed arity) so this keeps forwarding correctly if
    // TanStack changes the callback signature between minor versions.
    onSuccess: (...args) => {
      const [data, vars] = args
      const keys = typeof invalidates === 'function' ? invalidates(data, vars) : (invalidates ?? [])
      for (const queryKey of keys) queryClient.invalidateQueries({ queryKey })
      onSuccess?.(...args)
    },
  })
}
