/**
 * Browser-side environment validation for the staff PWA.
 *
 * All `VITE_*` values from `import.meta.env` are validated at app boot via
 * `validatePwaEnv()` in `main.tsx`. If a required value is missing or invalid,
 * the app refuses to start — CI/CD deploys without proper env config will fail
 * loudly rather than silently defaulting to localhost.
 *
 * Use the typed `env` accessor instead of raw `import.meta.env` everywhere.
 */
import { z } from 'zod'

const envSchema = z
  .object({
    /** Backend API base URL. Required. */
    VITE_API_URL: z.string().url({ message: 'VITE_API_URL must be a full URL' }),

    /** Better-Auth base URL (normally same as VITE_API_URL). Defaults to VITE_API_URL if absent. */
    VITE_BETTER_AUTH_URL: z.string().url().optional(),

    /** PWA public URL — used for password-reset email links etc. Optional. */
    VITE_APP_URL: z.string().optional(),

    /** Clinic branding shown on receipts / PDFs. */
    VITE_CLINIC_NAME: z.string().default('Denel Dental Clinic'),
    VITE_CLINIC_PHONE: z.string().optional(),
    VITE_CLINIC_ADDRESS: z.string().optional(),

    /**
     * Manual payment instructions surfaced to patients on the Pay-Invoice sheet.
     * The PWA does not process payments — patients transfer offline and the
     * clinic reconciles. Set in Doppler per environment. Multi-line strings are
     * allowed; the UI preserves line breaks.
     */
    VITE_CLINIC_BANK_DETAILS: z.string().optional(),
    VITE_CLINIC_MOMO_DETAILS: z.string().optional(),

    /** Sentry DSN — optional; if present, enables error reporting in production. */
    VITE_SENTRY_DSN: z.string().optional(),

    /**
     * Deployment environment — set in Doppler per config (dev/stg/prd). Vite's
     * MODE is always 'production' for any build, so it can't tell staging from
     * production; this drives the Sentry environment tag and the prod DSN gate.
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

export type PwaEnv = z.infer<typeof envSchema>

let cached: PwaEnv | null = null

/**
 * Validate env at boot and cache the result. Call from `main.tsx` before render.
 * Throws with a readable message if any required var is missing — do NOT catch
 * this at the application level; we want loud failures in CI and smoke tests.
 */
export function validatePwaEnv(): PwaEnv {
  if (cached) return cached

  const result = envSchema.safeParse(import.meta.env)
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    const message = `❌ PWA env validation failed:\n${issues}\n\nCheck your .env / Cloudflare Pages environment variables.`
    // eslint-disable-next-line no-console
    console.error(message)
    throw new Error(message)
  }
  cached = result.data
  return cached
}

/**
 * Typed accessor — use this instead of raw `import.meta.env` throughout the app.
 * Lazily validates on first access so module-level consumers (e.g. api clients)
 * don't need to worry about call order.
 */
export const env = new Proxy({} as PwaEnv, {
  get(_target, prop: string) {
    if (!cached) validatePwaEnv()
    return (cached as Record<string, unknown>)[prop]
  },
})
