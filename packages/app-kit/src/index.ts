// @denel/app-kit — shared headless app shell for the Framada Vite SPAs.
// Everything here is config-injected (app-id, env, paths via factories/props);
// nothing imports app-specific `@/config/*` or hardcodes an app identifier.

// API client
export {
  type ApiClient,
  type ApiClientConfig,
  type ApiRequestOptions,
  type ApiResponse,
  createApiClient,
} from './api/create-api-client'
// Auth (email + password)
export {
  type AuthConfig,
  type AuthContextValue,
  createAuth,
  type DenelAuth,
  type User,
} from './auth/create-auth'
// The password a person chooses for themselves (F20 / D8)
export { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, validateNewPassword } from './auth/password'
// Permissions
export {
  type PermissionsPayload,
  PermissionsProvider,
  usePermissions,
} from './auth/permissions-context'
// Components / guards
export { AppErrorBoundary } from './components/app-error-boundary'
// Error reporting
export {
  createErrorReporter,
  type ErrorContext,
  type ErrorReporter,
  type ErrorReporterConfig,
} from './error/create-error-reporter'
export { RouteSkeleton } from './guards/route-skeleton'
