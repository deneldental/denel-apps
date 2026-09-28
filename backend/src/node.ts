import { type Http2Bindings, type HttpBindings, serve } from '@hono/node-server'
import 'dotenv/config'
import { isSelfHealEnabled, validateBackendEnv } from './config/env'
import { logError } from './lib/logger'

// The Neon WS driver rejects an in-flight query's promise when its socket
// drops mid-request (compute suspend, idle reap, transient network blip —
// routine on the dev/staging Neon branch). `db/index.ts` already swallows
// the *pool*'s background 'error' event so idle-connection drops don't crash
// the process, but a drop while a query is actively in flight surfaces as an
// unhandled rejection instead, which Node treats as fatal by default — taking
// the whole server down mid dev-session for what is otherwise a transient,
// already-logged DB hiccup. Log and keep running rather than exit.
process.on('unhandledRejection', (reason) => {
  logError(reason, { context: '[process] unhandledRejection' })
})
process.on('uncaughtException', (err) => {
  logError(err, { context: '[process] uncaughtException' })
})

// Validate env at startup so the typed `env.X` accessor is populated
// before any request hits a route that uses it (auth.ts, checkPermission
// middleware, etc.). Throws fast on misconfigured deploys.
const backendEnv = validateBackendEnv()

const port = Number.parseInt(process.env.PORT ?? '3000', 10)

// ─── Readiness gate ─────────────────────────────────────────────────────────
//
// The port binds first; everything slow then happens in the background behind
// a readiness flag. Two things used to run before `serve()`, and together they
// made a cold start indistinguishable from a hang:
//
//   1. Loading the `./app` import graph (Hono routes -> drizzle -> puppeteer ->
//      aws-sdk -> ...). Under tsx this alone measured ~37s.
//   2. Seven serial schema self-heal scripts (~100 DDL round-trips) plus the
//      cron engine — ~18s against a remote Neon branch.
//
// Both now run inside `bootstrap()`, so the socket is listening almost
// immediately and can answer for itself. Until readiness flips, every request
// gets 503 rather than being handed to `app` — which preserves the original
// invariant (no request handler races an in-flight ALTER TABLE) while making
// the wait observable: a closed port tells you nothing, a 503 naming the step
// it is on tells you everything.
//
// Health probes stay honest: 503 with `ready: false` while warming up, never a
// premature "ok". Render (`healthCheckPath`), `.do/app.yaml` and the CI
// `wait_for` loop all poll until 2xx/3xx, so a 503 reads as "not live yet" —
// exactly as a refused connection did before.

type BootPhase = 'loading' | 'self-heal' | 'ready' | 'failed'

/** `app.fetch`, resolved lazily. Type-only import — no runtime cost. */
type AppFetch = typeof import('./app')['app']['fetch']

const bootStartedAt = Date.now()
// Time spent in module resolution/transpile before this file executed, so the
// boot log separates import cost from database cost.
const preludeMs = Math.round(process.uptime() * 1000)

const boot: {
  phase: BootPhase
  detail: string | null
  step: string | null
  error: string | null
} = {
  phase: 'loading',
  detail: 'loading application modules',
  step: null,
  error: null,
}

let appFetch: AppFetch | null = null

const isReady = () => boot.phase === 'ready' && appFetch !== null

function bootStatusBody() {
  return {
    status: isReady() ? 'ok' : 'starting',
    service: 'denel-backend',
    ready: isReady(),
    phase: boot.phase,
    detail: boot.detail,
    step: boot.step,
    elapsedMs: Date.now() - bootStartedAt,
    preludeMs,
    ...(boot.error ? { error: boot.error } : {}),
  }
}

function notReadyResponse(request: Request): Response {
  const path = new URL(request.url).pathname
  const isHealthProbe = path === '/api/health' || path === '/health'
  const body = isHealthProbe
    ? bootStatusBody()
    : { error: 'Server is starting', ...bootStatusBody() }

  const origin = request.headers.get('Origin')
  const corsHeaders: Record<string, string> = origin
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers':
          'Content-Type, Authorization, Accept, Origin, X-Requested-With, X-CSRF-Token, X-App-Id',
      }
    : {}

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    })
  }

  return new Response(JSON.stringify(body), {
    status: 503,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': '5',
      'Cache-Control': 'no-store',
      ...corsHeaders,
    },
  })
}

function fetchHandler(request: Request, env: HttpBindings | Http2Bindings) {
  const forward = appFetch
  if (!forward || boot.phase !== 'ready') return notReadyResponse(request)
  return forward(request, env)
}

serve({ fetch: fetchHandler, port }, (info) => {
  console.log(`Denel backend listening on port ${info.port} (warming up, not ready)`)
  console.log(
    `Environment: ${process.env.APP_ENV ?? 'development'} | self-heal=${
      isSelfHealEnabled() ? 'on' : 'off (SELF_HEAL_SCHEMAS)'
    } | prelude ${preludeMs}ms`
  )
  // Start the slow work only once the socket is actually listening, so the
  // "listening" line is never buried behind minutes of module load and DDL.
  void bootstrap()
})

/**
 * Background warm-up. Nothing here blocks the listen(); each phase is named and
 * timed in the log and mirrored onto /api/health.
 */
async function bootstrap() {
  try {
    // Sentry first, so anything thrown while the app graph loads is reported.
    // (Previously this ran *after* the hoisted `./app` import, so module-load
    // failures were never captured at all.) No-op without a DSN.
    if (backendEnv.SENTRY_DSN) {
      const Sentry = await import('@sentry/node')
      Sentry.init({
        dsn: backendEnv.SENTRY_DSN,
        environment: backendEnv.APP_ENV ?? backendEnv.NODE_ENV,
        // Stack traces only — no performance tracing overhead.
        tracesSampleRate: 0,
        // Capture unhandled promise rejections automatically.
        integrations: [],
      })
    }

    boot.phase = 'loading'
    boot.detail = 'loading application modules'
    const loadStartedAt = Date.now()
    const [{ app }, { setCronBootError, startCronEngine }, startup, { logger }] = await Promise.all(
      [import('./app'), import('./lib/cron'), import('./lib/startup'), import('./lib/logger')]
    )
    appFetch = app.fetch
    logger.info({ ms: Date.now() - loadStartedAt, preludeMs }, '[bootstrap] app modules loaded')

    boot.phase = 'self-heal'
    boot.detail = isSelfHealEnabled() ? 'schema self-heal + admin role sync' : 'admin role sync'
    const healStartedAt = Date.now()
    await Promise.all([
      startup.ensureSelfHealingSchemas((progress) => {
        boot.step = `${progress.index}/${progress.total} ${progress.step}`
        boot.detail = `self-heal ${boot.step}`
      }),
      startup.syncAdminRoleIds(),
    ])
    boot.step = null
    logger.info(
      { ms: Date.now() - healStartedAt },
      '[bootstrap] schema self-heal + role sync complete'
    )

    // Flip ready here, not after cron: request handlers only ever needed the
    // schema work to be finished. Cron is best-effort and its failures are
    // already non-fatal, so making traffic wait on it would be gratuitous.
    boot.phase = 'ready'
    boot.detail = null
    console.log(
      `Denel backend ready on port ${port} — ${Date.now() - bootStartedAt}ms after listen (prelude ${preludeMs}ms)`
    )

    // Cron engines are config-driven (see Integrations → Cron Engine). Started
    // after schema self-heal so cron_job_runs writes don't race a missing
    // table on a fresh install. Failures are non-fatal — the server still
    // serves requests; the admin gets a banner in the Integrations UI.
    const cronStartedAt = Date.now()
    await startCronEngine().catch((err) => {
      const msg: string = err?.message ?? String(err)
      setCronBootError(msg)
      console.warn('[bootstrap] cron engine failed to start:', msg)
    })
    logger.info({ ms: Date.now() - cronStartedAt }, '[bootstrap] cron engine started')
  } catch (err) {
    // Self-heal steps swallow their own errors, so reaching here means
    // something structural (module load failure, DB unreachable). Exit(1) as
    // the pre-gate bootstrap did, so the orchestrator restarts us rather than
    // leaving a half-initialised process listening.
    boot.phase = 'failed'
    boot.error = err instanceof Error ? err.message : String(err)
    boot.detail = 'startup failed — see logs'
    console.error('[bootstrap] fatal startup error:', err)
    process.exit(1)
  }
}
