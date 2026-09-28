/**
 * HR-app auth wiring. The implementation lives in `@denel/app-kit`'s
 * `createAuth` factory (email + password flow); this module just binds it to
 * the HR app's backend, `X-App-Id: hr`, and cache key, then re-exports the glue
 * so feature code imports a stable `@/lib/auth` path.
 *
 * `baseURL` is read from `import.meta.env` directly (a build-time constant) so
 * the auth client can be built at module load, before `validateHrEnv()` runs.
 */
import { createAuth } from '@denel/app-kit'

export const { authClient, AuthProvider, useAuth, RequireAuth } = createAuth({
  baseURL: import.meta.env.VITE_BETTER_AUTH_URL,
  appId: 'hr',
  cacheKey: 'hr_auth_user',
  loginPath: '/auth/login',
})

export type { User } from '@denel/app-kit'
