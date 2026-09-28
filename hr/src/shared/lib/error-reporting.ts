/**
 * HR-app error reporting. The implementation lives in `@denel/app-kit`'s
 * `createErrorReporter`; this module binds it to the HR app's Sentry DSN +
 * environment and re-exports the hooks so `main.tsx` and feature code import a
 * stable `@/shared/lib/error-reporting` path.
 *
 * Env values are read from `import.meta.env` directly (build-time constants) so
 * `reportError` is safe to call before `validateHrEnv()` runs.
 */
import { createErrorReporter } from '@denel/app-kit'

const reporter = createErrorReporter({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.VITE_APP_ENV,
  debug: import.meta.env.MODE !== 'production',
})

export const { initErrorReporting, reportError, attachGlobalErrorHandlers } = reporter
