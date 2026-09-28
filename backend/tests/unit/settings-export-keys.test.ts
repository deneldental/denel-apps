/**
 * settings-domain-audit A5 + D2: what a settings export carries.
 *   - every `integration_*` key except `integration_branding` (paths, not
 *     secrets) and every `integrations:*` key (Google OAuth config, service
 *     account, per-user contact tokens) stays out, on export AND import;
 *   - the six Settings-managed lookup tables the export used to miss are in.
 */
import { describe, expect, it } from 'vitest'
import { IMPORTABLE_TABLES, isExportableSettingKey } from '../../src/lib/settings-export'

describe('isExportableSettingKey', () => {
  it('keeps ordinary keys and the branding paths', () => {
    expect(isExportableSettingKey('module_visibility')).toBe(true)
    expect(isExportableSettingKey('inventory:policies')).toBe(true)
    expect(isExportableSettingKey('hr:roster_enabled')).toBe(true)
    expect(isExportableSettingKey('integration_branding')).toBe(true)
  })

  it('excludes every integration secret by prefix, not by a hand-kept list', () => {
    expect(isExportableSettingKey('integration_r2')).toBe(false)
    expect(isExportableSettingKey('integration_hubtel')).toBe(false)
    expect(isExportableSettingKey('integration_some_future_provider')).toBe(false)
    expect(isExportableSettingKey('integrations:google_oauth_config')).toBe(false)
    expect(isExportableSettingKey('integrations:google_service_account_config')).toBe(false)
    expect(isExportableSettingKey('integrations:google_contacts_token:user-1')).toBe(false)
  })
})

describe('IMPORTABLE_TABLES', () => {
  it('covers the lookup tables Settings manages', () => {
    for (const t of [
      'categories',
      'labCaseStatuses',
      'complianceTags',
      'patientTags',
      'reminderTemplates',
      'clinicHolidays',
    ]) {
      expect(IMPORTABLE_TABLES).toContain(t)
    }
  })

  it('leaves out id-linked stages and payroll-critical tax configurations', () => {
    expect(IMPORTABLE_TABLES).not.toContain('appointmentTypeReminders')
    expect(IMPORTABLE_TABLES).not.toContain('taxConfigurations')
  })
})
