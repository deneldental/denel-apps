/**
 * Browser-side environment validation for the portal (Vite SPA).
 *
 * All `VITE_*` values from `import.meta.env` are validated at app boot.
 * If a required value is missing or invalid, the app refuses to start —
 * CI/CD deploys without proper env config will fail loudly rather than at runtime.
 *
 * Call `validatePortalEnv()` once from `main.tsx` before React mounts.
 * Use `env` anywhere else to get the typed, validated values.
 */
import { z } from 'zod'

// ── Schema ───────────────────────────────────────────────────────────────────

const envSchema = z
  .object({
    /** Backend API base URL. Required. */
    VITE_API_URL: z.string().url({ message: 'VITE_API_URL must be a full URL' }),

    /** Better-Auth base URL (normally same as VITE_API_URL). Required. */
    VITE_BETTER_AUTH_URL: z.string().url({ message: 'VITE_BETTER_AUTH_URL must be a full URL' }),

    /** Portal app URL — used for absolute links in password-reset emails etc. */
    VITE_APP_URL: z.string().optional(),

    /** Clinic branding shown on receipts / PDFs. */
    VITE_CLINIC_NAME: z.string().default('Denel Dental Clinic'),
    VITE_CLINIC_PHONE: z.string().optional(),
    VITE_CLINIC_ADDRESS: z.string().optional(),

    /** Default country dialing code for phone inputs (digits only, e.g. "233" for Ghana). */
    VITE_COUNTRY_CODE: z.string().default('233'),

    /** Google OAuth client — optional, used only if Google Contacts sync is enabled. */
    VITE_GOOGLE_CLIENT_ID: z.string().optional(),

    /** Sentry DSN — required in production; optional in dev/staging. */
    VITE_SENTRY_DSN: z.string().optional(),

    /**
     * Deployment environment — set this in Doppler per config:
     *   dev → 'development', stg → 'staging', prd → 'production'
     * Vite's built-in MODE is always 'production' for any vite build,
     * so it cannot distinguish staging from production deployments.
     */
    VITE_APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),

    /** Build-time mode. Vite sets this automatically. */
    MODE: z.enum(['development', 'production', 'test']).default('development'),
  })
  .superRefine((data, ctx) => {
    if (data.VITE_APP_ENV === 'production' && !data.VITE_SENTRY_DSN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['VITE_SENTRY_DSN'],
        message: 'VITE_SENTRY_DSN is required in production — set it in Doppler prd config',
      })
    }
  })

export type PortalEnv = z.infer<typeof envSchema>

// ── Runtime-frozen, typed env object ─────────────────────────────────────────

let cached: PortalEnv | null = null

/**
 * Validate env at boot and cache the result. Call from `main.tsx` before render.
 * Throws with a readable message if any required var is missing — do NOT catch
 * this at the application level; we want loud failures in CI and during smoke tests.
 */
export function validatePortalEnv(): PortalEnv {
  if (cached) return cached

  const result = envSchema.safeParse(import.meta.env)
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    const message = `❌ Portal env validation failed:\n${issues}\n\nCheck your .env / Cloudflare Pages environment variables.`
    // Log to console before throwing so the error surfaces even if the throw is caught somewhere
    // eslint-disable-next-line no-console
    console.error(message)
    throw new Error(message)
  }
  cached = result.data
  return cached
}

/**
 * Typed accessor — use this instead of raw `import.meta.env` throughout the app.
 * Calling before `validatePortalEnv()` will throw (boot-order bug).
 */
export const env = new Proxy({} as PortalEnv, {
  get(_target, prop: string) {
    if (!cached) {
      throw new Error(
        `env accessed before validatePortalEnv() was called. Add the call in main.tsx before React mounts.`
      )
    }
    return (cached as Record<string, unknown>)[prop]
  },
})

/**
 * @deprecated — kept for back-compat with previous (incorrect) backend-style validation.
 * Do not use in new code. Prefer `env` (typed) or `validatePortalEnv()` (boot hook).
 */
export function validateEnv(): PortalEnv {
  return validatePortalEnv()
}

/** @deprecated — prefer `env`. */
export function getEnv(): PortalEnv {
  return validatePortalEnv()
}
