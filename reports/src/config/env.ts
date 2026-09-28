/**
 * Browser-side environment validation for the reports app (Vite SPA).
 *
 * All `VITE_*` values from `import.meta.env` are validated at app boot.
 * If a required value is missing or invalid, the app refuses to start —
 * CI/CD deploys without proper env config will fail loudly rather than at runtime.
 *
 * Call `validateReportsEnv()` once from `main.tsx` before React mounts.
 * Use `env` anywhere else to get the typed, validated values.
 */
import { z } from 'zod'

const envSchema = z
  .object({
    /** Backend API base URL. Required. */
    VITE_API_URL: z.string().url({ message: 'VITE_API_URL must be a full URL' }),

    /** Better-Auth base URL (normally same as VITE_API_URL). */
    VITE_BETTER_AUTH_URL: z.string().url().optional(),

    /** Reports app URL — used for absolute links in password-reset emails etc. */
    VITE_APP_URL: z.string().optional(),

    /** Clinic branding shown on receipts / PDFs. */
    VITE_CLINIC_NAME: z.string().default('Denel Dental Clinic'),
    VITE_CLINIC_PHONE: z.string().optional(),
    VITE_CLINIC_ADDRESS: z.string().optional(),
    VITE_CLINIC_WEBSITE: z.string().optional(),

    /** Sentry DSN — required in production; optional in dev/staging. */
    VITE_SENTRY_DSN: z.string().optional(),

    /**
     * Deployment environment — set this in Doppler per config:
     *   dev → 'development', stg → 'staging', prd → 'production'
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

export type ReportsEnv = z.infer<typeof envSchema>

let cached: ReportsEnv | null = null

export function validateReportsEnv(): ReportsEnv {
  if (cached) return cached

  const result = envSchema.safeParse(import.meta.env)
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    const message = `❌ Reports env validation failed:\n${issues}\n\nCheck your .env / Cloudflare Pages environment variables.`
    // eslint-disable-next-line no-console
    console.error(message)
    throw new Error(message)
  }
  cached = result.data
  return cached
}

export const env = new Proxy({} as ReportsEnv, {
  get(_target, prop: string) {
    if (!cached) {
      throw new Error(
        `env accessed before validateReportsEnv() was called. Add the call in main.tsx before React mounts.`
      )
    }
    return (cached as Record<string, unknown>)[prop]
  },
})
