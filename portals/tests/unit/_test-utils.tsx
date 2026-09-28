import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type RenderOptions, type RenderResult, render } from '@testing-library/react'
import { createContext, type ReactElement, type ReactNode, useContext } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

/**
 * A fresh, test-tuned QueryClient — no retries (a mocked rejection should
 * fail the assertion immediately, not spend real time retrying) and no
 * garbage-collection delay (avoids "state update after the test finished"
 * act() warnings from a query that outlives its test). One per render call
 * so tests never share cached data.
 */
function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
}

// ── Lightweight test-only auth context ───────────────────────────────────────
//
// Components that read session data via `authClient.useSession()` are mocked
// at the module level with `makeMockAuthClient`. Components that additionally
// (or alternatively) depend on a React-context-based auth value can receive a
// pre-populated context via the `authContext` option on `renderWithRouter`.
//
// The context shape mirrors the session user object surfaced by Better Auth
// with the portal's `inferAdditionalFields` plugin.

export interface AuthContextUser {
  id: string
  name: string
  email: string
  roleId?: string | null
  role?: string | null
}

interface AuthContextValue {
  user: AuthContextUser
}

/** Internal React context used only by the test utilities. */
const TestAuthContext = createContext<AuthContextValue | null>(null)

/** Hook that resolves the test auth context — available to test helpers only. */
export function useTestAuthContext(): AuthContextValue | null {
  return useContext(TestAuthContext)
}

/**
 * Wrap a component in MemoryRouter (so `<Link>`, `useNavigate`, and
 * `useLocation` work in JSDOM) and a fresh QueryClientProvider (so
 * `useApiQuery`/`useApiMutation` — this app's TanStack Query kit — don't
 * throw "No QueryClient set"). Optional initial route lets a test land the
 * component as if the user navigated to a specific URL.
 *
 * Pass `authContext` to additionally wrap the component in a
 * `TestAuthContext.Provider` carrying the supplied session user. This is
 * useful for auth-gated components that read from a React context rather
 * than calling `authClient.useSession()` directly. For the latter, continue
 * to use `vi.mock('@/lib/auth-client', ...)` with `makeMockAuthClient`.
 *
 * @example
 * renderWithRouter(<MyProtectedPage />, {
 *   authContext: { user: { id: 'u-1', name: 'Admin', email: 'admin@framada.app', roleId: 'admin' } },
 * })
 */
export function renderWithRouter(
  ui: ReactElement,
  options: RenderOptions & {
    initialRoute?: string
    authContext?: { user: AuthContextUser } | null
  } = {}
): RenderResult {
  const { initialRoute = '/', authContext, ...rest } = options
  const queryClient = createTestQueryClient()
  function Wrapper({ children }: { children: ReactNode }) {
    const inner = (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialRoute]}>{children}</MemoryRouter>
      </QueryClientProvider>
    )
    if (authContext) {
      return <TestAuthContext.Provider value={authContext}>{inner}</TestAuthContext.Provider>
    }
    return inner
  }
  return render(ui, { wrapper: Wrapper, ...rest })
}

// ── Auth mocking helpers ──────────────────────────────────────────────────────
//
// Components that call `authClient.useSession()` need the module to be mocked
// at the test-file level. Use `makeMockAuthClient()` to get a pre-wired object
// that satisfies the shape `@/lib/auth-client` exports.
//
// Usage in a test file:
//
//   import { makeMockAuthClient } from './_test-utils'
//
//   vi.mock('@/lib/auth-client', () => ({
//     authClient: makeMockAuthClient({ id: 'u-1', email: 'admin@framada.app', name: 'Admin' }),
//   }))

export interface MockSessionUser {
  id: string
  email: string
  name: string
  role?: string | null
  roleId?: string | null
}

/**
 * Returns a mock that satisfies the `authClient` contract expected by portal
 * components. Pass a `user` to simulate an authenticated session; omit or
 * pass `null` to simulate a logged-out state.
 *
 * Must be called inside a `vi.mock('@/lib/auth-client', () => ({ authClient: ... }))`
 * factory — see file-level JSDoc above.
 */
export function makeMockAuthClient(user: MockSessionUser | null = null) {
  const sessionData = user
    ? {
        user: { ...user, role: user.role ?? 'user', roleId: user.roleId ?? null },
        session: { id: 'sess-test', userId: user.id },
      }
    : null

  return {
    useSession: vi.fn().mockReturnValue({
      data: sessionData,
      isPending: false,
      error: null,
      refetch: vi.fn(),
    }),
    signIn: {
      email: vi.fn().mockResolvedValue({ data: null, error: null }),
    },
    signOut: vi.fn().mockResolvedValue({ data: null, error: null }),
    $fetch: vi.fn(),
    getSession: vi.fn().mockResolvedValue(sessionData),
  }
}
