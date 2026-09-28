import { describe, expect, it } from 'vitest'
import {
  atClockTime,
  DEFAULT_CRM_POLICIES,
  isWithinQuietHours,
  normalizeCrmPolicies,
  normalizeSmsTags,
} from './crm-policies'

/**
 * settings-domain-audit S5-B (CRM): `crm:automation_policies` as both the
 * backend (auto-queue, scheduler, reminder stages) and the portal read it.
 */
describe('normalizeCrmPolicies', () => {
  it('returns the defaults for nothing / junk', () => {
    expect(normalizeCrmPolicies(null)).toEqual(DEFAULT_CRM_POLICIES)
    expect(normalizeCrmPolicies('junk')).toEqual(DEFAULT_CRM_POLICIES)
  })

  it('keeps valid fields and falls back field by field', () => {
    const p = normalizeCrmPolicies({
      reminder24h: false,
      birthdaySendTime: '25:99',
      recallCheckupMonths: 0,
      recallPerioMonths: 4,
      quietHoursStart: '21:30',
      quietHoursEnd: 'never',
    })
    expect(p.reminder24h).toBe(false)
    expect(p.reminder2h).toBe(true)
    expect(p.birthdaySendTime).toBe(DEFAULT_CRM_POLICIES.birthdaySendTime)
    expect(p.recallCheckupMonths).toBe(DEFAULT_CRM_POLICIES.recallCheckupMonths)
    expect(p.recallPerioMonths).toBe(4)
    expect(p.quietHoursStart).toBe('21:30')
    expect(p.quietHoursEnd).toBe(DEFAULT_CRM_POLICIES.quietHoursEnd)
  })

  it('rewrites legacy {{snake_case}} tags into the engine placeholders', () => {
    const p = normalizeCrmPolicies({
      reminderTemplate: 'Hi {{patient_name}}, see you {{appointment_time}}',
      birthdayTemplate: 'Happy birthday {{ first_name }} from {{clinic_name}}',
    })
    expect(p.reminderTemplate).toBe('Hi {patientName}, see you {appointmentTime}')
    expect(p.birthdayTemplate).toBe('Happy birthday {firstName} from {clinicName}')
  })

  it('uses the default template for a blank one', () => {
    expect(normalizeCrmPolicies({ reminderTemplate: '   ' }).reminderTemplate).toBe(
      DEFAULT_CRM_POLICIES.reminderTemplate
    )
  })
})

describe('normalizeSmsTags', () => {
  it('leaves engine placeholders and unknown tags alone', () => {
    expect(normalizeSmsTags('{firstName} {{doctor_name}}')).toBe('{firstName} {doctor_name}')
  })
})

describe('quiet hours', () => {
  const at = (hhmm: string) => new Date(`2026-09-23T${hhmm}:00`)

  it('handles a same-day window', () => {
    expect(isWithinQuietHours(at('13:00'), '12:00', '14:00')).toBe(true)
    expect(isWithinQuietHours(at('14:00'), '12:00', '14:00')).toBe(false)
    expect(isWithinQuietHours(at('11:59'), '12:00', '14:00')).toBe(false)
  })

  it('handles an overnight window', () => {
    expect(isWithinQuietHours(at('22:00'), '20:00', '08:00')).toBe(true)
    expect(isWithinQuietHours(at('03:30'), '20:00', '08:00')).toBe(true)
    expect(isWithinQuietHours(at('08:00'), '20:00', '08:00')).toBe(false)
    expect(isWithinQuietHours(at('12:00'), '20:00', '08:00')).toBe(false)
  })

  it('is never quiet for an empty or invalid window', () => {
    expect(isWithinQuietHours(at('22:00'), '20:00', '20:00')).toBe(false)
    expect(isWithinQuietHours(at('22:00'), 'x', '08:00')).toBe(false)
  })

  it('atClockTime keeps the day and sets the time', () => {
    const d = atClockTime(new Date('2026-09-23T06:00:00'), '09:30')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(8)
    expect(d.getDate()).toBe(23)
    expect(d.getHours()).toBe(9)
    expect(d.getMinutes()).toBe(30)
  })
})
