import { describe, expect, it } from 'vitest'
import {
  isBroadcast,
  memoTargetsStaff,
  sanitizeAudienceFilter,
  summarizeAudience,
} from '../../src/lib/memo-audience'

describe('sanitizeAudienceFilter', () => {
  it('returns {} for non-object / null / undefined', () => {
    expect(sanitizeAudienceFilter(null)).toEqual({})
    expect(sanitizeAudienceFilter(undefined)).toEqual({})
    expect(sanitizeAudienceFilter('nope')).toEqual({})
    expect(sanitizeAudienceFilter(123)).toEqual({})
  })

  it('drops non-string and empty-string entries', () => {
    expect(
      sanitizeAudienceFilter({ roles: ['doctor', '', 7 as any, null as any, 'doctor'] })
    ).toEqual({ roles: ['doctor'] })
  })

  it('dedupes within each category', () => {
    expect(
      sanitizeAudienceFilter({
        roles: ['doctor', 'doctor', 'admin'],
        staffIds: ['s1', 's2', 's1'],
      })
    ).toEqual({
      roles: ['doctor', 'admin'],
      staffIds: ['s1', 's2'],
    })
  })

  it('omits a category whose final array is empty', () => {
    const out = sanitizeAudienceFilter({ roles: [], staffIds: ['s1'] })
    expect(out.roles).toBeUndefined()
    expect(out.staffIds).toEqual(['s1'])
  })
})

describe('isBroadcast', () => {
  it('treats empty filter as broadcast', () => {
    expect(isBroadcast({})).toBe(true)
    expect(isBroadcast({ roles: [], staffIds: [] })).toBe(true)
  })

  it('treats any non-empty category as targeted', () => {
    expect(isBroadcast({ roles: ['doctor'] })).toBe(false)
    expect(isBroadcast({ staffIds: ['s1'] })).toBe(false)
  })
})

describe('summarizeAudience', () => {
  it('falls back to "All Staff" for an empty filter', () => {
    expect(summarizeAudience({})).toBe('All Staff')
  })

  it('formats roles inline', () => {
    expect(summarizeAudience({ roles: ['doctor', 'admin'] })).toBe('doctor, admin')
  })

  it('joins categories with a middle dot', () => {
    expect(summarizeAudience({ roles: ['doctor'], staffIds: ['s1', 's2'] })).toBe(
      'doctor · 2 specific staff'
    )
  })

  it('summarises staffIds as a count, not the ids', () => {
    const out = summarizeAudience({ staffIds: ['s1', 's2', 's3'] })
    expect(out).toBe('3 specific staff')
  })
})

describe('memoTargetsStaff', () => {
  const ctx = { staffId: 's1', roleId: 'doctor' }

  it('empty filter targets every staff', () => {
    expect(memoTargetsStaff({}, ctx)).toBe(true)
    expect(memoTargetsStaff(null, ctx)).toBe(true)
    expect(memoTargetsStaff(undefined, ctx)).toBe(true)
  })

  it('staffIds match wins regardless of role mismatch', () => {
    expect(memoTargetsStaff({ staffIds: ['s1'], roles: ['other-role'] }, ctx)).toBe(true)
  })

  it('role match alone is enough', () => {
    expect(memoTargetsStaff({ roles: ['doctor'] }, ctx)).toBe(true)
  })

  it('returns false when none of the categories match', () => {
    expect(memoTargetsStaff({ staffIds: ['other'], roles: ['admin'] }, ctx)).toBe(false)
  })

  it('null roleId is gracefully ignored (staff with no role can still match staffIds)', () => {
    expect(memoTargetsStaff({ roles: ['doctor'] }, { staffId: 's1', roleId: null })).toBe(false)
    expect(memoTargetsStaff({ staffIds: ['s1'] }, { staffId: 's1', roleId: null })).toBe(true)
  })
})
