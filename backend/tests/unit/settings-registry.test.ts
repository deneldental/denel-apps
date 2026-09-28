/**
 * The settings registry (settings-domain-audit S1.1) is the allowlist behind
 * GET/PUT /api/settings/kv/:key. These tests pin three things:
 *
 *   1. every key a client actually reads or writes through the generic route
 *      is registered, with the gate the audit agreed on;
 *   2. keys that have their own route (integrations, Google, handbook, alert
 *      config, branding, low-stock, comms rates) are NOT registered — the
 *      generic route must not be a back door to them;
 *   3. each schema accepts exactly the shape its writer sends today, so no
 *      existing save starts failing.
 */
import { describe, expect, it } from 'vitest'
import {
  getSettingEntry,
  resolveSettingKey,
  SETTINGS_REGISTRY,
} from '../../src/lib/settings-registry'

const SESSION_READABLE = [
  'module_visibility',
  'monthly_threshold_config',
  'monthly_threshold_items',
  'operating_hours',
  'reminder_payment_cooldown_hours',
  'finance:petty_cash',
  'clinical:charting_preferences',
  'clinical:perio_thresholds',
  'crm:automation_policies',
  'inventory:policies',
  'security:kiosk_config',
  'security:audit_retention',
]

const HR_KEYS = [
  'hr:roster_enabled',
  'hr:org_chart_enabled',
  'hr:review_cycles_enabled',
  'hr:annual_leave_default_days',
  'hr:annual_leave_block_days',
]

/** Keys served by dedicated routes; must never resolve through the registry. */
const OWN_ROUTE_KEYS = [
  'integration_r2',
  'integration_do_spaces',
  'integration_cloudinary',
  'integration_hubtel',
  'integration_backup',
  'integration_storage_routing',
  'integration_upstash',
  'integration_cron_engine',
  'integration_anviz',
  'integration_branding',
  'integrations:google_oauth_config',
  'integrations:google_service_account_config',
  'integrations:google_calendar_auth_method',
  'integrations:google_contacts_token:user-1',
  'hr.handbook',
  'hr.attendance_config',
  'hr.breakfast_notifications_enabled',
  'appointment_alert_config',
  'settings:low_stock_alert_threshold',
  'settings:products:locked',
  'settings:inventory:locked',
  'settings:sms_cost_per_unit',
  'settings:email_cost_per_unit',
  'tax_rates',
  'treatment_gate.mode',
  // Listed in the old SESSION_READABLE_KEYS but read and written by nothing.
  'finance:payment_terms',
  'finance:aging_buckets',
  // Decorative settings removed in S5 (saved by a Settings section, read by
  // nothing). Their rows are deleted by migration 0222.
  'finance:currency',
  'finance:numbering_sequences',
  'scheduling:policies',
  'security:session_policy',
  'compliance:credential_alert_days',
  'hr:working_hours_policy',
]

/** One value per key, verbatim from the client that writes it. */
const SAMPLE_VALUES: Record<string, unknown> = {
  module_visibility: { insurance: false, labs: true },
  monthly_threshold_config: { enabled: true },
  monthly_threshold_items: {
    items: [
      {
        id: 'a',
        inventoryItemId: 'inv-1',
        inventoryItemName: 'Gloves',
        costPrice: 1250,
        quantity: 4,
      },
    ],
  },
  operating_hours: {
    monday: { open: true, openTime: '08:00', closeTime: '17:00' },
    sunday: { open: false, openTime: '08:00', closeTime: '17:00' },
  },
  reminder_payment_cooldown_hours: '24',
  'finance:petty_cash': {
    defaultFloat: 5000,
    singleApprovalLimit: 500,
    replenishWarningThreshold: 1000,
    maxActiveIousPerStaff: 2,
  },
  'clinical:charting_preferences': {
    notationSystem: 'palmer',
    deciduousNotation: 'fdi',
    defaultPrescriptionDays: 5,
    defaultLabTurnaroundDays: 7,
  },
  'clinical:perio_thresholds': { normalMaxMm: 3, moderateMaxMm: 5, severeMinMm: 6 },
  'crm:automation_policies': {
    reminder24h: true,
    reminder2h: true,
    reminderTemplate: 'Hello {{patient_name}}',
    birthdayGreetings: true,
    birthdaySendTime: '09:00',
    birthdayTemplate: 'Happy Birthday {{patient_name}}!',
    recallCheckupMonths: 6,
    recallPerioMonths: 3,
    recallScalingMonths: 6,
    quietHoursEnabled: true,
    quietHoursStart: '20:00',
    quietHoursEnd: '08:00',
  },
  'inventory:policies': {
    expiryWarningDays: 90,
    criticalExpiryDays: 30,
    valuationMethod: 'fifo',
    adjustmentReasons: ['Count Variance', 'Expired Stock'],
  },
  'security:kiosk_config': { idleLockSeconds: 90 },
  'security:audit_retention': { retentionPeriod: '1_year' },
  lab_commission_enabled: true,
  pwa_enabled_modules: ['dashboard', 'memos'],
  'hr:roster_enabled': true,
  'hr:org_chart_enabled': false,
  'hr:review_cycles_enabled': true,
  'hr:annual_leave_default_days': 20,
  'hr:annual_leave_block_days': null,
}

describe('settings registry — membership and gates', () => {
  it.each(
    SESSION_READABLE
  )('%s is readable by any session and written with settings:update', (key) => {
    const entry = getSettingEntry(key)
    expect(entry).toBeDefined()
    expect(entry?.read).toBe('session')
    expect(entry?.write).toEqual({ module: 'settings', action: 'update' })
  })

  it('lab_commission_enabled needs settings:read to read and settings:update to write', () => {
    const entry = getSettingEntry('lab_commission_enabled')
    expect(entry?.read).toEqual({ module: 'settings', action: 'read' })
    expect(entry?.write).toEqual({ module: 'settings', action: 'update' })
  })

  it('pwa_enabled_modules is admin-only to write (it is access control)', () => {
    const entry = getSettingEntry('pwa_enabled_modules')
    expect(entry?.read).toEqual({ module: 'settings', action: 'read' })
    expect(entry?.write).toBe('admin')
  })

  it.each(HR_KEYS)('%s is gated on staff:read / staff:update', (key) => {
    const entry = getSettingEntry(key)
    expect(entry?.read).toEqual({ module: 'staff', action: 'read' })
    expect(entry?.write).toEqual({ module: 'staff', action: 'update' })
  })

  it.each(OWN_ROUTE_KEYS)('%s is NOT reachable through the generic route', (key) => {
    expect(getSettingEntry(key)).toBeUndefined()
  })

  it('registers nothing beyond the audited inventory', () => {
    const expected = [
      ...SESSION_READABLE,
      'lab_commission_enabled',
      'pwa_enabled_modules',
      ...HR_KEYS,
    ]
    expect(Object.keys(SETTINGS_REGISTRY).sort()).toEqual(expected.sort())
  })
})

describe('settings registry — schemas accept what the writers send', () => {
  it.each(Object.entries(SAMPLE_VALUES))('%s accepts its sample value unchanged', (key, sample) => {
    const entry = getSettingEntry(key)
    expect(entry).toBeDefined()
    const parsed = entry?.schema.safeParse(sample)
    expect(parsed?.success).toBe(true)
    if (parsed?.success) expect(parsed.data).toEqual(sample)
  })

  it('every registered key has a sample above (so a new key cannot ship untested)', () => {
    expect(Object.keys(SAMPLE_VALUES).sort()).toEqual(Object.keys(SETTINGS_REGISTRY).sort())
  })

  it('rejects the wrong primitive for a boolean flag', () => {
    expect(getSettingEntry('hr:roster_enabled')?.schema.safeParse('true').success).toBe(false)
  })

  it('rejects a non-numeric cooldown but accepts number or numeric string', () => {
    const schema = getSettingEntry('reminder_payment_cooldown_hours')?.schema
    expect(schema?.safeParse(24).success).toBe(true)
    expect(schema?.safeParse('24').success).toBe(true)
    expect(schema?.safeParse('').success).toBe(false)
    expect(schema?.safeParse(-1).success).toBe(false)
  })

  it('rejects a module list that is not an array of strings', () => {
    expect(getSettingEntry('pwa_enabled_modules')?.schema.safeParse('dashboard').success).toBe(
      false
    )
  })
})

// settings-domain-audit D1 (S6): the five HR keys were renamed `hr.` → `hr:`.
// The old spelling still resolves so a client that has not redeployed keeps
// reading and writing the same row.
describe('settings registry — legacy hr. aliases', () => {
  it.each([
    ['hr.roster_enabled', 'hr:roster_enabled'],
    ['hr.org_chart_enabled', 'hr:org_chart_enabled'],
    ['hr.review_cycles_enabled', 'hr:review_cycles_enabled'],
    ['hr.annual_leave_default_days', 'hr:annual_leave_default_days'],
    ['hr.annual_leave_block_days', 'hr:annual_leave_block_days'],
  ])('%s resolves to %s', (legacy, canonical) => {
    expect(resolveSettingKey(legacy)).toBe(canonical)
    expect(getSettingEntry(legacy)).toBe(getSettingEntry(canonical))
  })

  it('leaves every other key alone', () => {
    expect(resolveSettingKey('module_visibility')).toBe('module_visibility')
    expect(resolveSettingKey('hr.handbook')).toBe('hr.handbook')
  })
})
