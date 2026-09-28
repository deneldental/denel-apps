/**
 * Browser-side environment validation for the patient app.
 *
 * All `VITE_*` values from `import.meta.env` are validated at app boot via
 * `validatePatientEnv()` in `main.tsx`. If a required value is missing or
 * invalid, the app refuses to start — CI/CD deploys without proper env config
 * fail loudly rather than silently defaulting to localhost.
 *
 * Use the typed `env` accessor instead of raw `import.meta.env` everywhere.
 */
import { z } from 'zod'

const envSchema = z
  .object({
    /** Backend API base URL. A full URL in production; an empty string in local
     *  dev, where the app talks to its own origin and Vite proxies `/api` to the
     *  backend (same-origin, no cross-origin CORS — see vite.config.ts). */
    VITE_API_URL: z.union([
      z.string().url({ message: 'VITE_API_URL must be a full URL' }),
      z.literal(''),
    ]),

    /** Better-Auth base URL — unused by patient auth (custom phone+OTP) but kept
     *  for parity with the shared env contract. Optional. */
    VITE_BETTER_AUTH_URL: z.string().url().optional(),

    /** Patient app public URL — used for password-reset / deep links etc. Optional. */
    VITE_APP_URL: z.string().optional(),

    /** Clinic branding shown on receipts / PDFs. */
    VITE_CLINIC_NAME: z.string().default('Denel Dental Clinic'),
    VITE_CLINIC_PHONE: z.string().optional(),
    VITE_CLINIC_ADDRESS: z.string().optional(),

    /** Manual payment instructions surfaced to patients on the Pay-Invoice sheet. */
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

export type PatientEnv = z.infer<typeof envSchema>

let cached: PatientEnv | null = null

/**
 * Validate env at boot and cache the result. Call from `main.tsx` before render.
 * Throws with a readable message if any required var is missing.
 */
export function validatePatientEnv(): PatientEnv {
  if (cached) return cached

  const result = envSchema.safeParse(import.meta.env)
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    const message = `❌ Patient env validation failed:\n${issues}\n\nCheck your .env / Cloudflare Pages environment variables.`
    // eslint-disable-next-line no-console
    console.error(message)
    throw new Error(message)
  }
  cached = result.data
  return cached
}

/**
 * Typed accessor — use this instead of raw `import.meta.env`. Lazily validates
 * on first access so module-level consumers don't depend on call order.
 */
export const env = new Proxy({} as PatientEnv, {
  get(_target, prop: string) {
    if (!cached) validatePatientEnv()
    return (cached as Record<string, unknown>)[prop]
  },
})
