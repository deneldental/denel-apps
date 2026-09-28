import { and, eq, isNull, ne, or } from 'drizzle-orm'
import { env, isSelfHealEnabled } from '../config/env'
import { getDb } from '../db'
import { roles, user } from '../db/schema'
import { checkInterfaceMapCoverage } from '../rbac/middleware/detectInterface'
import { ensureComplianceSchema } from './compliance-schema'
import { ensureDoctorSpecialistSchema } from './doctor-specialist-schema'
import { validateEnv } from './env'
import { ensureGoogleCalendarSchema } from './google-calendar-schema'
import { logger } from './logger'
import { ensureScopePks } from './scope-pk-self-heal'
import { ensureStaffMemosSchema } from './staff-memos-schema'
import { ensureStaffQuestionnairesSchema } from './staff-questionnaires-schema'
import { ensureTrainingMaterialsSchema } from './training-materials-schema'

/**
 * Ensures all users with Better Auth role='admin' have roleId='admin' wired up
 * in our RBAC system. Runs at startup so the PermissionEngine admin bypass fires
 * correctly even for accounts created before roleId was introduced.
 */
export async function syncAdminRoleIds(): Promise<void> {
  const startedAt = Date.now()
  try {
    const db = getDb(env.DATABASE_URL)

    // Ensure the 'admin' role row exists before updating users — the roleId FK
    // constraint blocks the UPDATE if the roles table hasn't been seeded yet.
    await db
      .insert(roles)
      .values({
        id: 'admin',
        name: 'Administrator',
        description: 'Full system access. Bypasses all permission checks.',
        isSystem: true,
      })
      .onConflictDoNothing()

    const result = await db
      .update(user)
      .set({ roleId: 'admin', updatedAt: new Date() })
      .where(and(eq(user.role, 'admin'), or(isNull(user.roleId), ne(user.roleId, 'admin'))))
    const count = result.rowCount ?? 0
    logger.info({ count, ms: Date.now() - startedAt }, '[startup] step "admin-roleid-sync" ok')
  } catch (err) {
    logger.warn(
      { err, ms: Date.now() - startedAt },
      '[startup] step "admin-roleid-sync" failed — PermissionEngine bypass may not fire for some admins'
    )
  }
}

/** Reported by node.ts on /api/health while the server is still warming up. */
export type SelfHealProgress = {
  /** Name of the step currently running, or the last one that ran. */
  step: string
  /** 1-based index of `step` within `total`. */
  index: number
  total: number
}

/**
 * Run idempotent CREATE IF NOT EXISTS / ALTER ADD COLUMN IF NOT EXISTS scripts
 * once at startup, so request handlers don't pay the cost on every call.
 *
 * These are self-healing scripts kept around for tables whose drizzle migration
 * may not yet have run on every environment. Failures are logged but not fatal.
 *
 * Every step is announced before it runs and timed after it finishes, so a slow
 * boot is legible in the log and can never again be mistaken for a hang. Pass
 * `onProgress` to surface the same information over HTTP.
 *
 * Skipped entirely when `SELF_HEAL_SCHEMAS` is falsy — see `isSelfHealEnabled()`.
 */
export async function ensureSelfHealingSchemas(
  onProgress?: (progress: SelfHealProgress) => void
): Promise<void> {
  if (!isSelfHealEnabled()) {
    logger.info('[startup] self-heal skipped (SELF_HEAL_SCHEMAS is off) — schema assumed migrated')
    return
  }

  const db = getDb(env.DATABASE_URL)
  const steps: Array<[string, () => Promise<void>]> = [
    ['staff-memos', () => ensureStaffMemosSchema(db)],
    ['staff-questionnaires', () => ensureStaffQuestionnairesSchema(db)],
    ['training-materials', () => ensureTrainingMaterialsSchema(db)],
    ['compliance', () => ensureComplianceSchema(db)],
    ['scope-pks', () => ensureScopePks(db)],
    // GCal tables must exist before doctor-specialist heal drops NOT NULL
    // on google_calendar_event_links.user_id.
    ['google-calendar', () => ensureGoogleCalendarSchema(db)],
    ['doctor-specialist', () => ensureDoctorSpecialistSchema(db)],
  ]

  const total = steps.length
  const allStartedAt = Date.now()
  let anyFailed = false

  for (const [index, [name, fn]] of steps.entries()) {
    onProgress?.({ step: name, index: index + 1, total })
    logger.info(`[startup] self-heal ${index + 1}/${total} "${name}" …`)
    const startedAt = Date.now()
    try {
      await fn()
      logger.info(
        { ms: Date.now() - startedAt },
        `[startup] self-heal ${index + 1}/${total} "${name}" ok`
      )
    } catch (err) {
      anyFailed = true
      logger.warn(
        { err, ms: Date.now() - startedAt },
        `[startup] self-heal ${index + 1}/${total} "${name}" failed — handlers may 500 if tables missing`
      )
    }
  }

  logger.info(
    { ms: Date.now() - allStartedAt, steps: total, anyFailed },
    anyFailed
      ? '[startup] Self-healing schemas finished with failures'
      : '[startup] Self-healing schemas ensured'
  )
}

/**
 * Validates environment and performs startup checks
 * Should be called once when the application starts
 */
export function performStartupChecks() {
  try {
    // Validate environment variables
    const env = validateEnv()
    logger.info('Environment validation passed')

    // DATABASE_URL is now required by the env schema, but double-check explicitly
    if (!env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not defined')
    }

    // Warn about missing optional configs
    if (!env.HUBTEL_CLIENT_ID || !env.HUBTEL_CLIENT_SECRET) {
      logger.warn('Hubtel SMS credentials not configured - SMS features will be unavailable')
    }

    if (!env.REDIS_URL) {
      logger.info('Redis not configured - using in-memory cache')
    }

    // L4 — CORS origins and the Origin→interface map must agree. A missing
    // entry has no symptom at request time, so it is surfaced here instead.
    const unmapped = checkInterfaceMapCoverage((process.env.ALLOWED_ORIGINS ?? '').split(','))
    if (unmapped.length > 0) {
      logger.warn(
        { unmapped },
        '[interface-map] These origins are allowed by CORS but have no entry in ORIGIN_TO_INTERFACE. ' +
          'Requests from them fall back to X-App-Id and then to "portal" for scope resolution. ' +
          'Add them to rbac/middleware/detectInterface.ts, or to INTENTIONALLY_UNMAPPED if that is correct.'
      )
    }

    logger.info({ nodeEnv: env.NODE_ENV }, 'Application startup checks completed successfully')

    return { success: true }
  } catch (error) {
    logger.fatal({ err: error }, 'Startup checks failed')
    throw error
  }
}
