import { describe, expect, it } from 'vitest'
import { LIFECYCLE_TEMPLATES, templateFor } from '../src/lib/lifecycle-tasks'

describe('lifecycle task templates', () => {
  it('has a template for every supported kind', () => {
    expect(LIFECYCLE_TEMPLATES.onboarding.length).toBeGreaterThan(0)
    expect(LIFECYCLE_TEMPLATES.offboarding.length).toBeGreaterThan(0)
    expect(LIFECYCLE_TEMPLATES.probation_review.length).toBeGreaterThan(0)
    expect(LIFECYCLE_TEMPLATES.contract_renewal.length).toBeGreaterThan(0)
  })

  it('every task key is unique within its template', () => {
    for (const kind of Object.keys(LIFECYCLE_TEMPLATES) as Array<
      keyof typeof LIFECYCLE_TEMPLATES
    >) {
      const keys = LIFECYCLE_TEMPLATES[kind].map((t) => t.key)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it('every task has a non-empty label', () => {
    for (const kind of Object.keys(LIFECYCLE_TEMPLATES) as Array<
      keyof typeof LIFECYCLE_TEMPLATES
    >) {
      for (const task of LIFECYCLE_TEMPLATES[kind]) {
        expect(task.label.trim().length).toBeGreaterThan(0)
        expect(task.key.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('templateFor returns the right list', () => {
    expect(templateFor('onboarding')).toBe(LIFECYCLE_TEMPLATES.onboarding)
    expect(templateFor('offboarding')).toBe(LIFECYCLE_TEMPLATES.offboarding)
  })
})
