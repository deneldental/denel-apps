import { z } from 'zod'

const envSchema = z.object({
  // Database — single connection string per environment, swapped via Doppler config
  DATABASE_URL: z.string().url(),

  // Hubtel SMS (optional but validated if present)
  HUBTEL_CLIENT_ID: z.string().optional(),
  HUBTEL_CLIENT_SECRET: z.string().optional(),
  HUBTEL_SENDER_ID: z.string().default('Denel'),
  PREPAID_DEPOSIT_ID: z.string().optional(),
  SMS_REDIRECT_PHONE: z.string().optional(),

  // SMS Templates (will move to admin settings / DB later)
  APPOINTMENT_SMS: z.string().optional(),
  PAYMENT_SMS: z.string().optional(),
  PAYMENT_PLAN_SMS: z.string().optional(),
  WELCOME_SMS: z.string().optional(),

  // App Configuration
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Email — Resend
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
  EMAIL_FROM: z.string().default('Denel Dental <info@deneldental.com>'),

  // Redis (optional for caching)
  REDIS_URL: z.string().url().optional(),
})

export type Env = z.infer<typeof envSchema>

let validatedEnv: Env | null = null

export function validateEnv(): Env {
  if (validatedEnv) {
    return validatedEnv
  }

  try {
    validatedEnv = envSchema.parse(process.env)
    return validatedEnv
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingVars = error.issues.map((err) => `${err.path.join('.')}: ${err.message}`)
      throw new Error(
        `Environment validation failed:\n${missingVars.join('\n')}\n\nPlease check your .env.local file.`
      )
    }
    throw error
  }
}

export function getEnv(): Env {
  if (!validatedEnv) {
    throw new Error('Environment not validated. Call validateEnv() first.')
  }
  return validatedEnv
}
