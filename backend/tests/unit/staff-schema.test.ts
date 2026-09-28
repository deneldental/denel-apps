/**
 * Unit tests for the canonical staff contract in @denel/types.
 *
 * This module is the single definition the HR wizard, the HR profile editors,
 * the public self-registration form and the backend handlers all build on. It
 * exists because those surfaces each hand-rolled their own field list and
 * validation and drifted apart — see
 * project-docs/staff-personal-data-build-plan.md.
 *
 * These are pure (no DB): they pin the contract itself. The behaviour of the
 * handlers that consume it lives in tests/integration/staff-personal-data.test.ts.
 */

import {
  AUDIT_REDACTED_FIELDS,
  canSelfServiceApply,
  deriveBirthDayMonth,
  EMPLOYMENT_KINDS,
  MOMO_NETWORKS,
  PAYROLL_SENSITIVE_FIELDS,
  PROFILE_CHANGE_TYPES,
  profileChangeRequestSchema,
  redactForAudit,
  registrationSubmitSchema,
  SEEDED_EMPLOYMENT_TYPES,
  SELF_SERVICE_FIELDS_BY_TYPE,
  updateStaffSchema,
  WRITABLE_STAFF_FIELDS,
} from '@denel/types'
import { describe, expect, it } from 'vitest'

// ── The allowlist ────────────────────────────────────────────────────────────

describe('WRITABLE_STAFF_FIELDS', () => {
  /**
   * The regression this whole effort exists to prevent: these 19 columns are
   * written by self-registration, and were absent from the hand-maintained
   * allowlist — so an approved staffer's Ghana Card PIN, address, next of kin,
   * education and consent record could never be corrected by any API.
   */
  it('includes every personal-data column self-registration writes', () => {
    const registrationOnlyColumns = [
      'dateOfBirth',
      'gender',
      'nationality',
      'maritalStatus',
      'ghanaCardPin',
      'residentialAddress',
      'digitalAddress',
      'nextOfKinName',
      'nextOfKinRelationship',
      'nextOfKinPhone',
      'emergencyContactRelationship',
      'highestQualification',
      'institution',
      'qualificationYear',
      'department',
      'consentGiven',
      'consentAt',
      'cvUrl',
      'salaryBand',
    ]
    const missing = registrationOnlyColumns.filter((f) => !WRITABLE_STAFF_FIELDS.includes(f))
    expect(missing).toEqual([])
  })

  /** The allowlist is a security boundary, not just a convenience. */
  it('excludes system-owned columns', () => {
    const systemOwned = [
      'id',
      'staffId',
      'userId',
      'specialistId',
      'isFirstLogin',
      'createdAt',
      'updatedAt',
      'deletedAt',
      'deletedById',
    ]
    const leaked = systemOwned.filter((f) => WRITABLE_STAFF_FIELDS.includes(f))
    expect(leaked).toEqual([])
  })

  /**
   * birthDay/birthMonth stay writable on purpose: the HR Identity sheet writes
   * them directly for records whose birth year is unknown. Dropping them as
   * "derived" would silently break birthday editing there.
   */
  it('keeps the legacy birthDay/birthMonth path writable', () => {
    expect(WRITABLE_STAFF_FIELDS).toContain('birthDay')
    expect(WRITABLE_STAFF_FIELDS).toContain('birthMonth')
  })
})

// ── Vocabularies ─────────────────────────────────────────────────────────────

describe('vocabularies', () => {
  /**
   * Employment type stopped being a fixed vocabulary in migration 0178 — it's
   * admin-managed data now (the `employment_types` lookup), so HR can add
   * "Locum (6 months)" without a deploy. These are only the seeded built-ins.
   */
  it('seeds the five built-in employment types', () => {
    expect([...SEEDED_EMPLOYMENT_TYPES]).toEqual([
      'permanent',
      'contract',
      'intern',
      'consultant',
      'external_trainer',
    ])
  })

  /**
   * The behaviour classes ARE fixed, and are what code keys off — a label an
   * admin can rename must never drive logic. Adding a kind here means teaching
   * the code a new behaviour, which is exactly the review gate we want.
   */
  it('pins the employment behaviour classes', () => {
    expect([...EMPLOYMENT_KINDS]).toEqual(['permanent', 'contract', 'trainer'])
  })

  /**
   * employmentType is a lookup slug, so the schema can no longer reject unknown
   * values — the DB FK to employment_types(name) and the route's resolver do
   * that. This pins the contract so nobody "fixes" it back into an enum and
   * breaks admin-added types.
   */
  it('accepts an admin-added employment type slug', () => {
    expect(updateStaffSchema.safeParse({ employmentType: 'locum_6mo' }).success).toBe(true)
  })

  /** Vodafone Ghana became Telecel in 2023; `vodafone` is retired. */
  it('momoNetwork uses the current brand, not the retired one', () => {
    expect([...MOMO_NETWORKS]).toEqual(['mtn', 'telecel', 'airteltigo'])
    expect(MOMO_NETWORKS).not.toContain('vodafone')
  })

  it('rejects a value outside the vocabulary', () => {
    expect(updateStaffSchema.safeParse({ momoNetwork: 'vodafone' }).success).toBe(false)
    expect(updateStaffSchema.safeParse({ gender: 'yes' }).success).toBe(false)
    expect(updateStaffSchema.safeParse({ momoNetwork: 'telecel' }).success).toBe(true)
  })
})

// ── DOB derivation (D2) ──────────────────────────────────────────────────────

describe('deriveBirthDayMonth', () => {
  it('derives day + month from a date of birth', () => {
    expect(deriveBirthDayMonth('1988-03-09')).toEqual({ birthDay: 9, birthMonth: 3 })
    expect(deriveBirthDayMonth(new Date('1990-12-25'))).toEqual({ birthDay: 25, birthMonth: 12 })
  })

  it('returns nulls for absent or unparseable input rather than throwing', () => {
    expect(deriveBirthDayMonth(null)).toEqual({ birthDay: null, birthMonth: null })
    expect(deriveBirthDayMonth(undefined)).toEqual({ birthDay: null, birthMonth: null })
    expect(deriveBirthDayMonth('not-a-date')).toEqual({ birthDay: null, birthMonth: null })
  })

  /** UTC, so a timezone west of Greenwich can't shift the birthday a day back. */
  it('reads the date in UTC', () => {
    expect(deriveBirthDayMonth('1988-03-09T00:00:00.000Z')).toEqual({ birthDay: 9, birthMonth: 3 })
  })
})

// ── Sensitivity tiers ────────────────────────────────────────────────────────

describe('audit redaction', () => {
  it('masks identifying numbers to a reconcilable tail', () => {
    const out = redactForAudit({
      bankAccountNumber: '1234567890124321',
      ssnitId: 'SSN-55556666',
      position: 'Hygienist',
    })
    expect(out.bankAccountNumber).toBe('••••4321')
    expect(out.ssnitId).toBe('••••6666')
    expect(out.position).toBe('Hygienist')
  })

  it('never leaks the raw value', () => {
    const raw = 'GHA-111222333-4'
    const out = redactForAudit({ ghanaCardPin: raw })
    expect(JSON.stringify(out)).not.toContain(raw)
  })

  it('masks a short value entirely rather than exposing most of it', () => {
    expect(redactForAudit({ ssnitId: 'AB12' }).ssnitId).toBe('••••')
  })

  it('leaves null as null instead of masking nothing into bullets', () => {
    expect(redactForAudit({ ssnitId: null }).ssnitId).toBeNull()
  })

  /**
   * Deliberately narrower than the payroll tier: bankName/momoNetwork aren't
   * secrets and bankAccountName is the staffer's own name. Masking them would
   * make the trail unreadable while protecting nothing.
   */
  it('does not mask non-secret payout fields', () => {
    const out = redactForAudit({ bankName: 'Absa', momoNetwork: 'telecel' })
    expect(out.bankName).toBe('Absa')
    expect(out.momoNetwork).toBe('telecel')
    expect(AUDIT_REDACTED_FIELDS).not.toContain('bankName')
  })

  /**
   * ghanaCardPin is redacted in the audit log but NOT payroll-gated: it's core
   * identity data HR must be able to correct, and gating it would re-freeze the
   * field this work unfroze.
   */
  it('redacts ghanaCardPin without payroll-gating it', () => {
    expect(AUDIT_REDACTED_FIELDS).toContain('ghanaCardPin')
    expect(PAYROLL_SENSITIVE_FIELDS).not.toContain('ghanaCardPin')
  })
})

// ── Employee self-service (Phase 7) ──────────────────────────────────────────

describe('self-service change requests', () => {
  /**
   * The four fields the Team app's ProfilePage actually offers. The approval
   * handler's old hard-coded allowlist was exactly these; the map must keep
   * covering them or staff self-service silently breaks.
   */
  it('still covers every field the staff app offers today', () => {
    expect(canSelfServiceApply('contact', 'phone')).toBe(true)
    expect(canSelfServiceApply('contact', 'email')).toBe(true)
    expect(canSelfServiceApply('emergency_contact', 'emergencyContactName')).toBe(true)
    expect(canSelfServiceApply('emergency_contact', 'emergencyContactPhone')).toBe(true)
  })

  /** `other` is the free-text escape hatch (except for cvUrl auto-apply). */
  it('auto-applies cvUrl for the "other" type, but nothing else', () => {
    expect(SELF_SERVICE_FIELDS_BY_TYPE.other).toEqual(['cvUrl'])
    expect(canSelfServiceApply('other', 'phone')).toBe(false)
  })

  /** Staff must not be able to self-serve their own identity or job terms. */
  it('refuses identity and employment fields', () => {
    for (const field of [
      'ghanaCardPin',
      'dateOfBirth',
      'employmentType',
      'position',
      'salaryBand',
    ]) {
      for (const type of PROFILE_CHANGE_TYPES) {
        expect(canSelfServiceApply(type, field)).toBe(false)
      }
    }
  })

  it('scopes fields to their change type', () => {
    // A bank field can't ride in on a `contact` request.
    expect(canSelfServiceApply('contact', 'bankAccountNumber')).toBe(false)
    expect(canSelfServiceApply('bank_details', 'bankAccountNumber')).toBe(true)
  })

  it('rejects an unknown change type', () => {
    expect(canSelfServiceApply('nonsense', 'phone')).toBe(false)
  })

  /** Every bank field is payroll-tier, so approving one needs payroll:update. */
  it('keeps bank_details fields inside the payroll tier', () => {
    for (const f of SELF_SERVICE_FIELDS_BY_TYPE.bank_details) {
      expect(PAYROLL_SENSITIVE_FIELDS).toContain(f)
    }
  })

  describe('profileChangeRequestSchema', () => {
    it('accepts a field + value pair', () => {
      const res = profileChangeRequestSchema.safeParse({
        changeType: 'contact',
        requestedData: {
          field: 'phone',
          currentValue: '+233200000000',
          requestedValue: '+233201111111',
        },
      })
      expect(res.success).toBe(true)
    })

    it('accepts free-text notes with no field', () => {
      const res = profileChangeRequestSchema.safeParse({
        changeType: 'other',
        requestedData: { notes: 'Please update my job title.' },
      })
      expect(res.success).toBe(true)
    })

    it('rejects a field with no value, and an empty request', () => {
      expect(
        profileChangeRequestSchema.safeParse({
          changeType: 'contact',
          requestedData: { field: 'phone' },
        }).success
      ).toBe(false)
      expect(
        profileChangeRequestSchema.safeParse({ changeType: 'other', requestedData: {} }).success
      ).toBe(false)
    })

    it('rejects an unknown change type', () => {
      expect(
        profileChangeRequestSchema.safeParse({
          changeType: 'salary',
          requestedData: { notes: 'more money' },
        }).success
      ).toBe(false)
    })

    /** requestedData is raw JSONB — cap it and strip unknowns. */
    it('caps oversized values and strips unknown keys', () => {
      expect(
        profileChangeRequestSchema.safeParse({
          changeType: 'other',
          requestedData: { notes: 'x'.repeat(1001) },
        }).success
      ).toBe(false)

      const res = profileChangeRequestSchema.safeParse({
        changeType: 'other',
        requestedData: { notes: 'ok', smuggled: 'nope' },
      })
      expect(res.success).toBe(true)
      if (res.success) expect(res.data.requestedData).not.toHaveProperty('smuggled')
    })
  })
})

// ── Registration contract (Phase 6) ──────────────────────────────────────────

describe('registrationSubmitSchema', () => {
  const valid = {
    fullName: 'Ama Mensah',
    dateOfBirth: '1992-05-04',
    gender: 'female',
    maritalStatus: 'single',
    ghanaCardPin: 'GHA-000111222-3',
    residentialAddress: '12 Independence Ave, Accra',
    digitalAddress: 'GA-123-4567',
    nextOfKinName: 'Kofi Mensah',
    nextOfKinRelationship: 'Father',
    nextOfKinPhone: '+233209876543',
    emergencyContactName: 'Akua Mensah',
    emergencyContactRelationship: 'Sister',
    emergencyContactPhone: '+233201234567',
    title: 'Dental Surgeon',
    // Department is a lookup slug and optional now; date of joining is optional.
    // Education fields dropped (they're on the CV). Bank only.
    department: 'dental',
    bankName: 'Absa',
    bankAccountName: 'Ama Mensah',
    bankAccountNumber: '0123456789',
    consentGiven: true,
  }

  it('accepts a complete submission', () => {
    expect(registrationSubmitSchema.safeParse(valid).success).toBe(true)
  })

  it('reports every missing field at once, not one at a time', () => {
    const res = registrationSubmitSchema.safeParse({ consentGiven: true })
    expect(res.success).toBe(false)
    if (!res.success) {
      // A 19-required-field form is miserable to fix one error per round-trip.
      expect(res.error.issues.length).toBeGreaterThan(5)
    }
  })

  it('requires consent (Act 843)', () => {
    const res = registrationSubmitSchema.safeParse({ ...valid, consentGiven: false })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(res.error.issues.some((i) => /consent/i.test(i.message))).toBe(true)
    }
  })

  /**
   * Bank only now, matching the HR form. Mobile money was removed from both
   * intake paths — a momo-only submission has no bank set, so it fails, and the
   * momo keys are stripped as unknown.
   */
  it('rejects a momo-only submission (bank only)', () => {
    const { bankName, bankAccountName, bankAccountNumber, ...rest } = valid
    const momo = { ...rest, momoNetwork: 'telecel', momoNumber: '0201234567' }
    const res = registrationSubmitSchema.safeParse(momo)
    expect(res.success).toBe(false)
    if (res.success) expect(res.data).not.toHaveProperty('momoNetwork')
  })

  it('rejects a submission with no bank details', () => {
    const { bankName, bankAccountName, bankAccountNumber, ...rest } = valid
    const res = registrationSubmitSchema.safeParse(rest)
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(res.error.issues.some((i) => /bank/i.test(i.message))).toBe(true)
    }
  })

  it('shape-checks the Ghana Card PIN', () => {
    expect(registrationSubmitSchema.safeParse({ ...valid, ghanaCardPin: '123' }).success).toBe(
      false
    )
    expect(
      registrationSubmitSchema.safeParse({ ...valid, ghanaCardPin: 'GHA-000111222-3' }).success
    ).toBe(true)
  })

  it('accepts a submission with no department (optional now)', () => {
    const { department, ...rest } = valid
    expect(registrationSubmitSchema.safeParse(rest).success).toBe(true)
  })

  /** An account number with no bank name is useless to whoever runs the pay run. */
  it('rejects a half-filled bank set', () => {
    const { bankName, ...rest } = valid
    expect(registrationSubmitSchema.safeParse(rest).success).toBe(false)
  })

  /**
   * `submittedData` is raw JSONB — before this schema, an unvalidated body of
   * any shape was persisted verbatim. zod strips unknown keys, so a crafted
   * payload can't smuggle extra data into the invite row.
   */
  it('strips unknown keys instead of persisting them', () => {
    const res = registrationSubmitSchema.safeParse({
      ...valid,
      isAdmin: true,
      __proto__hack: 'x',
      hugeBlob: 'y'.repeat(1000),
    })
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data).not.toHaveProperty('isAdmin')
      expect(res.data).not.toHaveProperty('hugeBlob')
    }
  })

  it('rejects a momo network outside the canonical vocabulary', () => {
    const { bankName, bankAccountName, bankAccountNumber, ...rest } = valid
    const stale = { ...rest, momoNetwork: 'vodafone', momoNumber: '0201234567' }
    expect(registrationSubmitSchema.safeParse(stale).success).toBe(false)
  })
})
