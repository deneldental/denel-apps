/**
 * Error-reporter factory — routes to Sentry when a DSN is configured, else a
 * no-op that logs to the console in dev. Env values (dsn, environment) are
 * injected by the consuming app so this stays free of `import.meta.env` /
 * app-specific config.
 */

export interface ErrorContext {
  scope?: string
  componentStack?: string
  [key: string]: unknown
}

export interface ErrorReporterConfig {
  /** Sentry DSN. When empty/undefined, reporting is a console-only no-op. */
  dsn?: string
  /** Deployment environment tag for Sentry (e.g. 'production'). */
  environment?: string
  /** When true, `reportError` also logs to the console. Defaults to dev only. */
  debug?: boolean
}

export interface ErrorReporter {
  initErrorReporting: () => Promise<void>
  reportError: (error: unknown, context?: ErrorContext) => void
  attachGlobalErrorHandlers: () => void
}

export function createErrorReporter(config: ErrorReporterConfig): ErrorReporter {
  const { dsn, environment, debug } = config
  let sentryInstance: typeof import('@sentry/react') | null = null
  let initPromise: Promise<void> | null = null

  async function initErrorReporting(): Promise<void> {
    if (initPromise) return initPromise
    initPromise = (async () => {
      if (!dsn) return
      try {
        const sentry = await import('@sentry/react')
        sentry.init({ dsn, environment, tracesSampleRate: 0, integrations: [] })
        sentryInstance = sentry
      } catch (err) {
        console.error('[error-reporting] failed to initialise Sentry:', err)
      }
    })()
    return initPromise
  }

  function reportError(error: unknown, context?: ErrorContext): void {
    try {
      if (sentryInstance) {
        sentryInstance.captureException(error, { extra: context ?? {} })
        return
      }
    } catch {
      // never let telemetry break the app
    }
    if (debug) {
      console.error('[reportError]', error, context)
    }
  }

  function attachGlobalErrorHandlers(): void {
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

  return { initErrorReporting, reportError, attachGlobalErrorHandlers }
}
