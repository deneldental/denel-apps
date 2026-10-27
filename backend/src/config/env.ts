import { z } from 'zod'

const envSchema = z.object({
  // ── Runtime ────────────────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  APP_ENV: z.enum(['development', 'staging', 'production']).optional(),
  PORT: z.coerce.number().default(3000),

  // ── Database ───────────────────────────────────────────────────────────────
  DATABASE_URL: z.string().url({ message: 'DATABASE_URL must be a valid URL' }),

  // ── Auth (Better Auth) ─────────────────────────────────────────────────────
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, { message: 'BETTER_AUTH_SECRET must be at least 32 chars' }),
  BETTER_AUTH_URL: z.string().url({ message: 'BETTER_AUTH_URL must be a valid URL' }),

  // ── Private files ──────────────────────────────────────────────────────────
  // Signs the tag on every stored `private-file://` reference (lib/private-files.ts):
  // only references carrying a valid tag are ever turned into download links.
  // Keep it forever and identical wherever this database is restored —
  // changing it makes every stored private file unviewable. Required in staging
  // and production (assertPrivateFileSecretConfigured); locally, private files
  // are unavailable until it is set.
  PRIVATE_FILE_REF_SECRET: z
    .string()
    .min(32, { message: 'PRIVATE_FILE_REF_SECRET must be at least 32 chars' })
    .optional(),

  // ── CORS ───────────────────────────────────────────────────────────────────
  ALLOWED_ORIGINS: z.string().optional(),
  // Where people are sent by a link: the clinic portal (confirmation SMS, X-ray share links,
  // document signing, the return from Google) and the patient app (the invitation text). Optional
  // here so development runs without them (lib/public-urls.ts falls back to the local servers);
  // staging and production must set both (assertPublicUrlsConfigured).
  PORTAL_URL: z.string().url().optional(),
  PATIENT_PORTAL_URL: z.string().url().optional(),

  // ── Clinic branding (runtime fallback; preferred source is clinic_settings DB) ──
  CLINIC_NAME: z.string().default('Denel Dental Clinic'),
  CLINIC_PHONE: z.string().optional(),
  CLINIC_ADDRESS: z.string().optional(),

  // ── Email (Resend) ─────────────────────────────────────────────────────────
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().email().optional(),

  // ── SMS (Hubtel) ───────────────────────────────────────────────────────────
  HUBTEL_CLIENT_ID: z.string().optional(),
  HUBTEL_CLIENT_SECRET: z.string().optional(),
  HUBTEL_SENDER_ID: z.string().optional(),
  // Local development only: every SMS goes to this number instead of its real
  // recipient. Unset, nothing leaves the machine — messages are printed and
  // logged as simulated (lib/sms.ts). Ignored in staging and production.
  SMS_REDIRECT_PHONE: z.string().optional(),

  // ── Google Calendar OAuth (per-user 2-way sync; all optional — integration
  //    is no-op if these aren't set, GET /status returns "unconfigured") ─────
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  // Full callback URL Google should redirect to. Must match what's registered
  // in the Google Cloud OAuth consent screen.
  // e.g. https://api.deneldental.com/api/google-calendar/callback
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url().optional(),

  // ── SMS templates (override defaults in constants.ts) ─────────────────────
  APPOINTMENT_SMS: z.string().optional(),
  PAYMENT_SMS: z.string().optional(),
  PAYMENT_PLAN_SMS: z.string().optional(),
  WELCOME_SMS: z.string().optional(),

  // Storage providers are configured in the admin Integrations UI (DB-backed
  // KV under `clinic_settings`). No env vars are read at runtime — see
  // `backend/src/lib/storage-providers.ts` and `lib/storage-router.ts`. The
  // one-shot `backend/scripts/seed-storage-from-env.ts` script can migrate
  // pre-existing env-driven configs into the DB.

  // ── PDF generation ────────────────────────────────────────────────────────
  PDF_TEMPLATE_BASE_URL: z.string().url().optional(),

  // ── Feature flags ────────────────────────────────────────────────────────
  // Set to 'true' in dev/staging only. Never set in production.
  ALLOW_TABLE_CLEAR: z.string().optional(),

  // Startup schema self-heal (backend/src/lib/startup.ts). Seven idempotent
  // DDL scripts (~100 serial statements) run on every boot. Unset means ON —
  // staging and production are unchanged. Set to 'false' (or 0/off/no) in
  // local dev to skip them once the schema is known good; against a remote
  // Neon branch they dominate cold start. Parsed by `isSelfHealEnabled()`,
  // which is deliberately permissive so a typo can never disable self-heal
  // in production.
  SELF_HEAL_SCHEMAS: z.string().optional(),

  // ── Observability ─────────────────────────────────────────────────────────
  // Sentry DSN for backend error tracking. Required in production — set in
  // Doppler prd config. Optional in dev/staging (errors logged to console).
  SENTRY_DSN: z.string().optional(),

  // ── Trusted client address ─────────────────────────────────────────────────
  // Declared here so the deployment has to STATE its topology rather than
  // inherit a default. `lib/rate-limiter.ts` still reads process.env directly
  // (it must work before validation runs); these entries exist to validate the
  // values and to drive the deploy-time check in `assertTrustedIpConfigured`.
  //
  // TRUSTED_IP_HEADER — the one header the proxy in front sets and overwrites
  //   on every request. `cf-connecting-ip` behind Cloudflare Tunnel.
  // TRUSTED_IP_MODE — what to do when no client address can be established:
  //   enforce (reject), dryrun (log + allow), off (allow silently).
  TRUSTED_IP_HEADER: z.string().min(1).optional(),
  TRUSTED_IP_MODE: z.enum(['off', 'dryrun', 'enforce']).optional(),
})

export type BackendEnv = z.infer<typeof envSchema>

let cached: BackendEnv | null = null

/**
 * Parse and validate all backend env vars once at startup.
 * Throws with a clear message if any required var is missing — a
 * misconfigured deploy fails immediately, not on the first affected request.
 * Call from app.ts before any routes are mounted.
 */
export function validateBackendEnv(): BackendEnv {
  if (cached) return cached

  const result = envSchema.safeParse(process.env)
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    const message = `❌ Backend env validation failed:\n${issues}\n\nCheck your Doppler config or .env file.`
    console.error(message)
    throw new Error(message)
  }
  // Cached only once the deploy-time checks have passed: a configuration that was refused must not
  // be served to the next caller as if it had been accepted.
  const parsed = result.data
  assertTrustedIpConfigured(parsed)
  assertPrivateFileSecretConfigured(parsed)
  assertPublicUrlsConfigured(parsed)
  cached = parsed
  return cached
}

/**
 * A deployed backend has to say where the portal and the patient app live, and neither address may
 * point at the machine itself. They are the addresses put into appointment-confirmation SMS, X-ray
 * share links, document-signing links, the return from Google and the patient-app invitation.
 * `PORTAL_URL` used to be optional and the routes fell back to the patient app's host (which has
 * none of those pages) or to `http://localhost:5173`, so a deploy that lacked them started and
 * quietly sent people dead links. Development is exempt: lib/public-urls.ts uses the local servers.
 */
function assertPublicUrlsConfigured(e: BackendEnv): void {
  const deployed = (e.APP_ENV ?? e.NODE_ENV) !== 'development'
  if (!deployed) return

  const problems: string[] = []
  for (const [name, value] of [
    ['PORTAL_URL', e.PORTAL_URL],
    ['PATIENT_PORTAL_URL', e.PATIENT_PORTAL_URL],
  ] as const) {
    if (!value) problems.push(`${name} is not set`)
    else if (pointsAtThisMachine(value)) problems.push(`${name} points at this machine (${value})`)
  }
  if (problems.length === 0) return

  const message = [
    `❌ ${problems.join('; ')}.`,
    '',
    'These are the addresses put into appointment-confirmation SMS, X-ray share links, document-signing',
    'links, the return from Google and the patient-app invitation. A backend that does not know them',
    'would send people to a page that does not exist.',
    '',
    '  PORTAL_URL          the clinic portal, e.g. https://portal.deneldental.com',
    '  PATIENT_PORTAL_URL  the patient app,   e.g. https://app.deneldental.com',
  ].join('\n')
  console.error(message)
  throw new Error(message)
}

/** localhost, loopback, 0.0.0.0 and *.localhost: an address that only means something on the machine it is read on. */
function pointsAtThisMachine(address: string): boolean {
  let host: string
  try {
    host = new URL(address).hostname.toLowerCase()
  } catch {
    return false // not a URL at all: the schema's own check reports that
  }
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '0.0.0.0' ||
    host === '[::1]' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  )
}

/**
 * A deployed instance without PRIVATE_FILE_REF_SECRET could neither store nor
 * show a single private file, so it refuses to start rather than half-work.
 * Development is exempt: uploads fail with a clear message until it is set.
 */
function assertPrivateFileSecretConfigured(e: BackendEnv): void {
  const deployed = (e.APP_ENV ?? e.NODE_ENV) !== 'development'
  if (!deployed || e.PRIVATE_FILE_REF_SECRET) return
  const message =
    '❌ PRIVATE_FILE_REF_SECRET is not set. Add a random value of at least 32 characters ' +
    'in Doppler (see project-docs/secrets-and-integrations.md) — it must never change afterwards.'
  console.error(message)
  throw new Error(message)
}

/**
 * Refuse to start a deployed instance that has not stated its edge topology.
 *
 * `TRUSTED_IP_MODE` defaults to `enforce`, which is the correct end state but
 * is only safe once a trusted proxy is actually in front: with nothing setting
 * the header, every public request has no resolvable address and
 * `requireClientIp` rejects it. The ordering advice for that ("stand the tunnel
 * up first, or run dryrun until it is live") lived only in a code comment, and
 * the variable was set in no env file, no CI workflow and no service config —
 * the same "control that exists but never fires" pattern as the never-set
 * SCOPE_ENFORCEMENT and the un-bundled audit script.
 *
 * So staging and production must say which it is. Development is exempt: the
 * loopback fallback in `clientIp()` covers localhost, and a dev hitting the box
 * over a LAN address should not be blocked from booting.
 */
function assertTrustedIpConfigured(e: BackendEnv): void {
  const deployed = (e.APP_ENV ?? e.NODE_ENV) !== 'development'
  if (!deployed || e.TRUSTED_IP_MODE) return

  const message = [
    '❌ TRUSTED_IP_MODE is not set.',
    '',
    'It governs what happens when a request has no resolvable client address,',
    'and it defaults to "enforce" — which rejects every public request unless a',
    'trusted proxy sets TRUSTED_IP_HEADER (default: cf-connecting-ip).',
    '',
    'Set it explicitly for this environment:',
    '  enforce — the proxy is live and the header is arriving (the goal)',
    '  dryrun  — not behind the proxy yet; log what would be rejected',
    '  off     — no address-based limiting at this tier',
  ].join('\n')
  console.error(message)
  throw new Error(message)
}

/** Typed env accessor. Throws if called before validateBackendEnv(). */
export const env = new Proxy({} as BackendEnv, {
  get(_target, prop: string) {
    if (!cached) {
      throw new Error(
        `env.${prop} accessed before validateBackendEnv() was called. Call it in app.ts at startup.`
      )
    }
    return (cached as Record<string, unknown>)[prop]
  },
})

/**
 * True unless `SELF_HEAL_SCHEMAS` is explicitly set to a falsy string
 * (`false` / `0` / `off` / `no`, case-insensitive).
 *
 * Default ON, so staging and production behave exactly as before — only an
 * explicit opt-out disables the startup DDL scripts. Lives here rather than in
 * `lib/startup.ts` so `node.ts` can read it without pulling the db/schema
 * import graph in before the port binds.
 */
export function isSelfHealEnabled(): boolean {
  const raw = process.env.SELF_HEAL_SCHEMAS
  if (raw === undefined || raw === null) return true
  return !/^(false|0|off|no)$/i.test(raw.trim())
}

/**
 * The environment this process is actually running as.
 *
 * ─── Why this exists ───────────────────────────────────────────────────────
 * `APP_ENV` was compared directly in ~15 places, and it is set in **no Doppler
 * dev config** — so `env.APP_ENV === 'development'` was false on every
 * developer's machine, and `env.APP_ENV !== 'production'` was true on every
 * deployed one. The same unset variable therefore broke local development AND
 * opened a hole in production, in opposite directions:
 *
 *   - `lib/staff-session.ts` emitted `Secure; SameSite=None` over plain HTTP
 *     locally, so the browser dropped the cookie and staff login could not work
 *     on localhost at all (L7).
 *   - `routes/staff-registration.ts` gated its `devCode` response on
 *     `APP_ENV !== 'production'`, so a deployment with `APP_ENV` unset
 *     **returned the registration OTP in the HTTP response body**.
 *
 * Resolving the pair fixes both, because they are set in complementary places:
 * `NODE_ENV=production` is baked into the Dockerfile and set by `render.yaml`,
 * while neither is set locally.
 *
 * Reads `process.env` rather than the `env` proxy so it is safe to call from
 * module scope, before `validateBackendEnv()` has run.
 */
export function resolvedEnvironment(): 'development' | 'staging' | 'production' {
  const appEnv = (process.env.APP_ENV ?? '').trim().toLowerCase()
  const nodeEnv = (process.env.NODE_ENV ?? '').trim().toLowerCase()

  for (const raw of [appEnv, nodeEnv]) {
    if (raw === 'production' || raw === 'staging' || raw === 'development') return raw
  }

  // NEITHER is set. That is a local checkout — `NODE_ENV=production` is baked
  // into the Dockerfile and set explicitly by render.yaml, so a deployed
  // instance always has one — and it matches the schema default for NODE_ENV.
  //
  // Getting this branch wrong is not theoretical: the first version returned
  // 'production' here on the reasoning that unknown should be strict, which made
  // `isDevEnvironment()` false on every developer's machine. That silently
  // re-broke the very thing this helper was written to fix (L7: `Secure;
  // SameSite=None` cookies over plain HTTP) and made `sendSMS` throw
  // 'Hubtel credentials not configured' locally. Caught by a smoke test, not by
  // the type checker — which is the point.
  if (!appEnv && !nodeEnv) return 'development'

  // Set, but to something unrecognised ("prod", "stage", a typo). Callers use
  // this to decide whether to RELAX a control, so garbage must fail closed —
  // that is precisely the polarity `staff-registration.ts` got wrong.
  return 'production'
}

/** True only when this process is genuinely a local development run. */
export function isDevEnvironment(): boolean {
  return resolvedEnvironment() === 'development'
}
