import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { BrandingProvider } from '@/lib/branding-context'
import { LoadingProvider } from '@/lib/loading-context'
import { SonnerToaster } from '@/shared/components/sonner-toaster'

// Singleton QueryClient — shared across the entire portal SPA.
//
// Refresh model (data-refresh plan, phase 0): a `useQuery` result is fresh for
// `staleTime`, then TanStack Query refetches it in the background when the tab
// regains focus, the network reconnects, or the component remounts (e.g. you
// navigate back to a list). Mutations still drive the immediate update via
// `queryClient.invalidateQueries`; this only closes the "came back to the tab
// and it's stale" gap. Affects features already on `useQuery` — the remaining
// `useEffect` + `api.get` fetches are unaffected until migrated.
// Exported so code outside the React tree (event handlers, plain async
// helpers like `invalidateAppointmentPickerCache`) can invalidate/read the
// same cache the app's components observe via context.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // 30 s — dedupe bursts; still refetches once stale
      gcTime: 5 * 60_000, // 5 min — keep unused cache before GC
      retry: 1, // one retry on network failure
      refetchOnWindowFocus: true, // stale data refreshes when you return to the tab
      refetchOnReconnect: true, // …and when the connection comes back
    },
    mutations: {
      retry: 0,
    },
  },
})

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <BrandingProvider>
        <LoadingProvider>
          {children}
          <SonnerToaster />
        </LoadingProvider>
      </BrandingProvider>
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  )
}
