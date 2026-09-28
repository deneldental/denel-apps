/**
 * Settings key registry — the allowlist behind `GET`/`PUT /api/settings/kv/:key`.
 *
 * Every key the generic KV route may serve is declared here with three things:
 *
 *   read   — who may GET it. `'session'` means any signed-in user: these are
 *            feature switches the UI must consult before it can decide what to
 *            render, so gating them on `settings:read` protects nothing and
 *            just makes the feature vanish for every role without the grant
 *            (`module_visibility` builds the sidebar, `monthly_threshold_config`
 *            shows/hides the Threshold page, …).
 *   write  — who may PUT it. `'admin'` is reserved for keys that shape what
 *            OTHER people can do (`pwa_enabled_modules` decides which modules
 *            the Team app exposes). Everything else is `settings:update`, or
 *            `staff:update` for the `hr.` keys the HR app owns.
 *   schema — what a PUT's `value` must look like. Each schema mirrors exactly
 *            what the key's writer sends today, and objects are `looseObject`
 *            so a field a client adds later is stored, not stripped. The
 *            parsed value is what gets written.
 *
 * Keys that have their own route — `integration_*`, `integrations:google_*`,
 * `hr.handbook`, `hr.attendance_config`, `hr.breakfast_notifications_enabled`,
 * `appointment_alert_config`, branding, the low-stock threshold, the comms
 * rates — are deliberately absent: the generic route must not be a back door
 * to them (settings-domain-audit A1). An unregistered key is a 404.
 *
 * No defaults live here on purpose: `GET` returns `null` for a missing row and
 * every client merges its own defaults, so a server-side default would change
 * what they receive. Revisit when a setting gains a backend consumer (S5).
 */
import { normalizeCrmPolicies } from '@denel/utils'
import { z } from 'zod'
import type { DB } from '../db'
import { ACTIONS, MODULES } from './modules'

export type SettingGate = { module: string; action: string }
/** `'session'` — any signed-in user; otherwise the permission that unlocks it. */
export type SettingRead = 'session' | SettingGate
/** `'admin'` — `roleId === 'admin'` only; otherwise the permission that unlocks it. */
export type SettingWrite = 'admin' | SettingGate

export interface SettingEntry {
  schema: z.ZodType
  read: SettingRead
  write: SettingWrite
  /**
   * Runs after a successful PUT, with the validated value. For the few keys
   * whose value must be applied somewhere else (S5-B: CRM reminder stages).
   * A throw makes the route answer 500 so the caller knows the automation
   * was not applied, although the row itself is saved.
   */
  onWrite?: (ctx: { db: DB; value: unknown; userId: string }) => Promise<void>
  /** Who writes it and who reads it, so the entry can be judged without a grep. */
  description: string
}

const SETTINGS_READ: SettingGate = { module: MODULES.SETTINGS, action: ACTIONS.READ }
const SETTINGS_UPDATE: SettingGate = { module: MODULES.SETTINGS, action: ACTIONS.UPDATE }
const STAFF_READ: SettingGate = { module: MODULES.STAFF, action: ACTIONS.READ }
const STAFF_UPDATE: SettingGate = { module: MODULES.STAFF, action: ACTIONS.UPDATE }

// ── Shared fragments ──────────────────────────────────────────────────────────

const nonNegative = z.number().min(0)
const nonNegativeInt = z.number().int().min(0)
/** `HH:mm` as the portal's `<input type="time">` produces. */
const clockTime = z.string()

const daySchedule = z.looseObject({
  open: z.boolean(),
  openTime: clockTime,
  closeTime: clockTime,
})

const thresholdItem = z.looseObject({
  id: z.string(),
  inventoryItemId: z.string(),
  inventoryItemName: z.string(),
  costPrice: z.number(),
  quantity: z.number(),
})

/** A session-readable, `settings:update`-writable entry — the common case. */
function clinicSetting(schema: z.ZodType, description: string): SettingEntry {
  return { schema, read: 'session', write: SETTINGS_UPDATE, description }
}

/** An `hr.`-namespaced entry owned by the HR app: `staff:read` / `staff:update`. */
function hrSetting(schema: z.ZodType, description: string): SettingEntry {
  return { schema, read: STAFF_READ, write: STAFF_UPDATE, description }
}

// ── The registry ──────────────────────────────────────────────────────────────

export const SETTINGS_REGISTRY: Readonly<Record<string, SettingEntry>> = {
  // ── Session-readable feature switches and policies (portal Settings) ──────
  module_visibility: clinicSetting(
    z.record(z.string(), z.boolean()),
    'Module id → visible. Written by Settings → Module Visibility; read by the sidebar and mobile drawer.'
  ),
  monthly_threshold_config: clinicSetting(
    z.looseObject({ enabled: z.boolean() }),
    'Written by Settings → Inventory → Monthly Threshold; read by InventoryLayout and Reports → Monthly.'
  ),
  monthly_threshold_items: clinicSetting(
    z.looseObject({ items: z.array(thresholdItem) }),
    'Written by Inventory → Monthly Threshold page; read there and by Reports → Monthly.'
  ),
  operating_hours: clinicSetting(
    z.record(z.string(), daySchedule),
    'Day → schedule. Written by Settings → Clinic Profile → Operating Hours.'
  ),
  reminder_payment_cooldown_hours: clinicSetting(
    // The portal sends the input value as a string ("24"); routes/reminders.ts
    // does Number() on read, so both forms are accepted.
    z.union([nonNegative, z.string().regex(/^\d+(\.\d+)?$/)]),
    'Minimum hours between payment-reminder SMS to one patient. Written by Settings → CRM; read by routes/reminders.ts.'
  ),
  'finance:petty_cash': clinicSetting(
    z.looseObject({
      defaultFloat: z.number(),
      singleApprovalLimit: z.number(),
      replenishWarningThreshold: z.number(),
      maxActiveIousPerStaff: z.number(),
    }),
    'Written by Settings → Finance → Petty Cash Policy.'
  ),
  'clinical:charting_preferences': clinicSetting(
    // S5-B: the four prosthesis SLA fields became one `defaultLabTurnaroundDays`
    // (migration 0223 rewrites stored rows). `deciduousNotation` is stored but
    // nothing charts primary dentition yet.
    z.looseObject({
      notationSystem: z.enum(['fdi', 'universal', 'palmer']),
      deciduousNotation: z.enum(['fdi', 'letter']),
      defaultPrescriptionDays: z.number(),
      defaultLabTurnaroundDays: z.number(),
    }),
    'Written by Settings → Clinical → Charting Preferences; notation + prescription days are read by the portal (odontogram, perio chart, treatment plans, x-rays, case prescription stage), defaultLabTurnaroundDays by routes/labs.ts via lib/settings-store.'
  ),
  'clinical:perio_thresholds': clinicSetting(
    z.looseObject({
      normalMaxMm: z.number(),
      moderateMaxMm: z.number(),
      severeMinMm: z.number(),
    }),
    'Written by Settings → Clinical → Charting Preferences (perio card); read by the portal perio chart (cell colours, legend) and the clinical analytics page.'
  ),
  'crm:automation_policies': {
    ...clinicSetting(
      z.looseObject({
        reminder24h: z.boolean(),
        reminder2h: z.boolean(),
        reminderTemplate: z.string(),
        birthdayGreetings: z.boolean(),
        birthdaySendTime: clockTime,
        birthdayTemplate: z.string(),
        recallCheckupMonths: z.number(),
        recallPerioMonths: z.number(),
        recallScalingMonths: z.number(),
        quietHoursEnabled: z.boolean(),
        quietHoursStart: clockTime,
        quietHoursEnd: clockTime,
      }),
      'Written by Settings → CRM → Automations; read by lib/crm-autoqueue (birthday segment), lib/scheduler (quiet hours) and the recare form (recall presets). Saving also syncs the two global reminder stages (lib/crm-reminder-stages).'
    ),
    onWrite: async ({ db, value, userId }) => {
      // Lazy: keeps the registry free of DB-touching imports for the route tests.
      const { syncCrmReminderStages } = await import('./crm-reminder-stages')
      await syncCrmReminderStages(db, normalizeCrmPolicies(value), userId)
    },
  },
  'inventory:policies': clinicSetting(
    z.looseObject({
      expiryWarningDays: z.number(),
      criticalExpiryDays: z.number(),
      valuationMethod: z.enum(['fifo', 'weighted_average']),
      adjustmentReasons: z.array(z.string()),
    }),
    'Written by Settings → Inventory → Store Policies.'
  ),
  'security:kiosk_config': clinicSetting(
    // Only the field the kiosk reads. `enableSelfCheckIn` / `requirePinForExit`
    // were saved and read by nothing (settings-domain-audit S5).
    z.looseObject({ idleLockSeconds: z.number() }),
    'Written by Settings → Security & Kiosk; read by the kiosk page (idle reset).'
  ),
  'security:audit_retention': clinicSetting(
    z.looseObject({
      retentionPeriod: z.enum(['90_days', '180_days', '1_year', 'indefinite']),
    }),
    'Written by Settings → Security & Kiosk; read by the monthly audit-retention cron via lib/settings-store.getAuditRetentionDays.'
  ),

  // ── settings:read to read ─────────────────────────────────────────────────
  lab_commission_enabled: {
    schema: z.boolean(),
    read: SETTINGS_READ,
    write: SETTINGS_UPDATE,
    description:
      'Whether lab work pays doctor commission. Written by Labs → Vendors (gated on settings:update in the UI); read by lib/lab-case-billing.ts.',
  },
  pwa_enabled_modules: {
    schema: z.array(z.string()),
    read: SETTINGS_READ,
    // Access control, not a preference: routes/auth.ts strips every module not
    // in this list from what the Team app can see, for every staff account.
    write: 'admin',
    description:
      'Module ids the Team app may expose. Written by Access Management → PWA matrix; read by routes/auth.ts on each PWA session.',
  },

  // ── hr: keys owned by the HR app (staff:read / staff:update) ──────────────
  // Namespace convention (S6 / D1): `<domain>:<name>` for every generic KV key;
  // `integration_*` / `integrations:*` are served by their own secret routes;
  // `settings:*` are store-backed (lib/settings-store); `hr.handbook` and
  // friends keep their own routes and their dot names.
  'hr:roster_enabled': hrSetting(
    z.boolean(),
    'HR feature flag. Written by Access Management (portal + HR app); read via GET /api/settings/hr-features.'
  ),
  'hr:org_chart_enabled': hrSetting(
    z.boolean(),
    'HR feature flag. Written by Access Management (portal + HR app); read via GET /api/settings/hr-features.'
  ),
  'hr:review_cycles_enabled': hrSetting(
    z.boolean(),
    'HR feature flag. Written by Access Management (portal + HR app); read via GET /api/settings/hr-features.'
  ),
  'hr:annual_leave_default_days': hrSetting(
    nonNegativeInt,
    'Total leave days per year. Written by HR → Requests → Leave defaults; read by routes/staff-attendance.ts.'
  ),
  'hr:annual_leave_block_days': hrSetting(
    // null = "auto: half of the total", which is what the HR app sends when the
    // field is blank. A null on this key clears the row (see routes/settings.ts).
    nonNegativeInt.nullable(),
    'Annual-block portion of the total leave, or null for a 50/50 split. Written by HR → Requests → Leave defaults; read by routes/staff-attendance.ts.'
  ),
}

/**
 * Renamed keys (settings-domain-audit D1, S6): the five HR keys moved from the
 * `hr.` to the `hr:` namespace every other generic KV key uses; migration 0225
 * renamed the rows. A client that still sends the old spelling reads and
 * writes the same row.
 */
const LEGACY_KEY_ALIASES: Record<string, string> = {
  'hr.roster_enabled': 'hr:roster_enabled',
  'hr.org_chart_enabled': 'hr:org_chart_enabled',
  'hr.review_cycles_enabled': 'hr:review_cycles_enabled',
  'hr.annual_leave_default_days': 'hr:annual_leave_default_days',
  'hr.annual_leave_block_days': 'hr:annual_leave_block_days',
}

/** The key a row is stored under — legacy spellings map to their canonical key. */
export function resolveSettingKey(key: string): string {
  return LEGACY_KEY_ALIASES[key] ?? key
}

export function getSettingEntry(key: string): SettingEntry | undefined {
  const canonical = resolveSettingKey(key)
  return Object.hasOwn(SETTINGS_REGISTRY, canonical) ? SETTINGS_REGISTRY[canonical] : undefined
}
