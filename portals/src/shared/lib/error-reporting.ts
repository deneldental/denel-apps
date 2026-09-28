/**
 * Centralised error reporting — routes to Sentry when configured, otherwise a
 * no-op that only logs to the console in dev.
 *
 * Sentry is initialised lazily via `initErrorReporting()` so dev builds don't
 * pull it in when no DSN is set.
 */

import { env } from '@/config/env'

type ErrorContext = {
  scope?: string
  componentStack?: string
  [key: string]: unknown
}

let sentryInstance: typeof import('@sentry/react') | null = null
let initPromise: Promise<void> | null = null

/**
 * Initialise Sentry if VITE_SENTRY_DSN is set. Safe to call multiple times —
 * only the first call triggers actual init. Never throws; logs and continues
 * so env / network issues don't break the whole app.
 */
export async function initErrorReporting(): Promise<void> {
  if (initPromise) return initPromise
  initPromise = (async () => {
    const dsn = env.VITE_SENTRY_DSN
    if (!dsn) return

    try {
      const sentry = await import('@sentry/react')
      sentry.init({
        dsn,
        environment: env.VITE_APP_ENV,
        // Stack traces only — no performance monitoring until explicitly enabled
        tracesSampleRate: 0,
        // Capture unhandled promise rejections automatically
        integrations: [],
      })
      sentryInstance = sentry
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[error-reporting] failed to initialise Sentry:', err)
    }
  })()
  return initPromise
}

/**
 * Report an error to the configured sink. Falls back to console in dev.
 */
export function reportError(error: unknown, context?: ErrorContext): void {
  try {
    if (sentryInstance) {
      sentryInstance.captureException(error, { extra: context ?? {} })
      return
    }
  } catch {
    // Never let telemetry break the app
  }
  if (env.MODE !== 'production') {
    // eslint-disable-next-line no-console
    console.error('[reportError]', error, context)
  }
}

/**
 * Attach global listeners for unhandled promise rejections + uncaught errors.
 * Called once from `main.tsx` after `initErrorReporting()`.
 */
export function attachGlobalErrorHandlers(): void {
  window.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason, { kind: 'unhandledrejection' })
  })
  window.addEventListener('error', (event) => {
    reportError(event.error ?? event.message, {
      kind: 'uncaught',
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    })
  })
}
