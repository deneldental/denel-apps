import { describe, expect, it } from 'vitest'
import { toLookupSlug } from './slug'

/**
 * settings-domain-audit D4: the settings sections had four different slug
 * generators, so the same display name produced different `name`s depending
 * on which section created it. This is the one rule.
 */
describe('toLookupSlug', () => {
  it('lower-cases and joins words with underscores', () => {
    expect(toLookupSlug('Follow Up')).toBe('follow_up')
  })

  it('treats any run of non-alphanumerics as one separator', () => {
    expect(toLookupSlug('Pieces (pcs)')).toBe('pieces_pcs')
    expect(toLookupSlug('Follow-up / Review')).toBe('follow_up_review')
  })

  it('never leaves a leading or trailing separator', () => {
    expect(toLookupSlug('  (Box)  ')).toBe('box')
    expect(toLookupSlug('Pieces (pcs)')).not.toMatch(/_$/)
  })

  it('is empty when nothing usable remains', () => {
    expect(toLookupSlug('')).toBe('')
    expect(toLookupSlug('   ')).toBe('')
    expect(toLookupSlug('()')).toBe('')
  })

  it('keeps digits', () => {
    expect(toLookupSlug('Tier 2 Scaling')).toBe('tier_2_scaling')
  })

  it('supports the kebab-case convention document tags use', () => {
    expect(toLookupSlug('Consent Form', { separator: '-' })).toBe('consent-form')
    expect(toLookupSlug('X-ray', { separator: '-' })).toBe('x-ray')
  })

  it('is idempotent', () => {
    const once = toLookupSlug('Dental Surgeon (Senior)')
    expect(toLookupSlug(once)).toBe(once)
  })
})
