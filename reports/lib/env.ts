import { z } from 'zod'

const envSchema = z.object({
  // Backend URLs
  NEXT_PUBLIC_API_URL: z.string().url(),
  NEXT_PUBLIC_BETTER_AUTH_URL: z.string().url().optional(),

  // Hubtel SMS (optional but validated if present)
  HUBTEL_CLIENT_ID: z.string().optional(),
  HUBTEL_CLIENT_SECRET: z.string().optional(),
  PREPAID_DEPOSIT_ID: z.string().optional(),
  SMS_SENDER_NAME: z.string().default('Framada'),

  // SMS Templates
  APPOINTMENT_SMS: z.string().optional(),
  PAYMENT_SMS: z.string().optional(),
  PAYMENT_PLAN_SMS: z.string().optional(),

  // App Configuration
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Redis (optional for caching)
  REDIS_URL: z.string().url().optional(),
})

export type Env = z.infer<typeof envSchema>

let validatedEnv: Env | null = null

export function validateEnv(): Env {
  if (validatedEnv) {
    return validatedEnv
  }

  // Use compile-time environment variables for Next.js client-side
  const envData = {
    NEXT_PUBLIC_API_URL: import.meta.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_BETTER_AUTH_URL: import.meta.env.NEXT_PUBLIC_BETTER_AUTH_URL,
    HUBTEL_CLIENT_ID: process.env.HUBTEL_CLIENT_ID,
    HUBTEL_CLIENT_SECRET: process.env.HUBTEL_CLIENT_SECRET,
    PREPAID_DEPOSIT_ID: process.env.PREPAID_DEPOSIT_ID,
    SMS_SENDER_NAME: process.env.SMS_SENDER_NAME,
    APPOINTMENT_SMS: process.env.APPOINTMENT_SMS,
    PAYMENT_SMS: process.env.PAYMENT_SMS,
    PAYMENT_PLAN_SMS: process.env.PAYMENT_PLAN_SMS,
    NODE_ENV: process.env.NODE_ENV,
    LOG_LEVEL: process.env.LOG_LEVEL,
    REDIS_URL: process.env.REDIS_URL,
  }

  try {
    validatedEnv = envSchema.parse(envData)
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
    return validateEnv()
  }
  return validatedEnv
}
