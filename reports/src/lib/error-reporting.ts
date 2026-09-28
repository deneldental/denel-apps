/**
 * Reports error reporting — routes to Sentry when a DSN is configured, else a
 * no-op that only logs to the console in dev. Loaded lazily so dev builds with
 * no DSN don't pull Sentry in. Never throws.
 */

import { env } from '../config/env'

type ErrorContext = {
  scope?: string
  componentStack?: string
  [key: string]: unknown
}

let sentryInstance: typeof import('@sentry/react') | null = null
let initPromise: Promise<void> | null = null

/** Initialise Sentry if VITE_SENTRY_DSN is set. Idempotent; never throws. */
export async function initErrorReporting(): Promise<void> {
  if (initPromise) return initPromise
  initPromise = (async () => {
    const dsn = env.VITE_SENTRY_DSN
    if (!dsn) return
    try {
      const sentry = await import('@sentry/react')
      sentry.init({
        dsn,
        // The DEPLOY environment (development/staging/production) — not Vite's
        // MODE, which is always 'production' for any build.
        environment: env.VITE_APP_ENV,
        tracesSampleRate: 0,
        integrations: [],
      })
      sentryInstance = sentry
    } catch (err) {
      console.error('[error-reporting] failed to initialise Sentry:', err)
    }
  })()
  return initPromise
}

/** Report an error to Sentry, or the console in dev. Never throws. */
export function reportError(error: unknown, context?: ErrorContext): void {
  try {
    if (sentryInstance) {
      sentryInstance.captureException(error, { extra: context ?? {} })
      return
    }
  } catch {
    // never let telemetry break the app
  }
  if (env.VITE_APP_ENV !== 'production') {
    console.error('[reportError]', error, context)
  }
}

/** Attach global handlers for unhandled rejections + uncaught errors. */
export function attachGlobalErrorHandlers(): void {
  window.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason, { kind: 'unhandledrejection' })
  })
  window.addEventListener('error', (event) => {
    reportError(event.error ?? event.message, {
      kind: 'uncaught',
      filename: event.filename,
      lineno: event.lineno,
    })
  })
}
