import { describe, expect, it } from 'vitest'
import { computeChangedFields, redactForAudit } from '../../src/lib/audit'

describe('computeChangedFields', () => {
  it('returns [] when both sides are null', () => {
    expect(computeChangedFields(null, null)).toEqual([])
  })
  it('returns [] when only before is null', () => {
    expect(computeChangedFields(null, { a: 1 })).toEqual([])
  })
  it('returns [] when only after is null', () => {
    expect(computeChangedFields({ a: 1 }, null)).toEqual([])
  })

  it('detects simple scalar changes', () => {
    const before = { id: 'p1', name: 'Alice', age: 30 }
    const after = { id: 'p1', name: 'Alicia', age: 30 }
    expect(computeChangedFields(before, after)).toEqual(['name'])
  })

  it('detects multiple field changes, sorted alphabetically', () => {
    const before = { id: 'p1', name: 'Alice', age: 30, email: 'a@x' }
    const after = { id: 'p1', name: 'Alicia', age: 31, email: 'a@y' }
    expect(computeChangedFields(before, after)).toEqual(['age', 'email', 'name'])
  })

  it('detects new fields added', () => {
    const before = { id: 'p1' }
    const after = { id: 'p1', phone: '555-0100' }
    expect(computeChangedFields(before, after)).toEqual(['phone'])
  })

  it('detects removed fields', () => {
    const before = { id: 'p1', phone: '555-0100' }
    const after = { id: 'p1' }
    expect(computeChangedFields(before, after)).toEqual(['phone'])
  })

  it('ignores timestamp and sensitive-hash columns', () => {
    const before = {
      id: 'p1',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-04-01'),
      pwaPasswordHash: 'old-hash',
      name: 'Alice',
    }
    const after = {
      id: 'p1',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-04-15'), // changed
      pwaPasswordHash: 'new-hash', // changed
      name: 'Alicia', // changed
    }
    expect(computeChangedFields(before, after)).toEqual(['name'])
  })

  it('treats Date objects and ISO strings consistently', () => {
    const d = new Date('2026-04-15T00:00:00Z')
    const before = { id: 'p1', dob: d }
    const after = { id: 'p1', dob: d.toISOString() }
    expect(computeChangedFields(before, after)).toEqual([])
  })

  it('treats undefined and null as equivalent', () => {
    const before = { id: 'p1', notes: undefined }
    const after = { id: 'p1', notes: null }
    expect(computeChangedFields(before, after)).toEqual([])
  })

  it('detects nested object changes via JSON compare', () => {
    const before = { id: 'p1', meta: { flag: true } }
    const after = { id: 'p1', meta: { flag: false } }
    expect(computeChangedFields(before, after)).toEqual(['meta'])
  })

  it('detects array changes via JSON compare', () => {
    const before = { id: 'p1', tags: ['a', 'b'] }
    const after = { id: 'p1', tags: ['a', 'c'] }
    expect(computeChangedFields(before, after)).toEqual(['tags'])
  })
})

describe('redactForAudit', () => {
  it('returns null when input is null', () => {
    expect(redactForAudit(null)).toBeNull()
  })

  it('keeps timestamp columns intact', () => {
    const row = {
      id: 'p1',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-04-15'),
      name: 'Alice',
    }
    const out = redactForAudit(row)
    expect(out?.createdAt).toBeInstanceOf(Date)
    expect(out?.updatedAt).toBeInstanceOf(Date)
  })

  it('strips sensitive fields', () => {
    const row = {
      id: 'p1',
      name: 'Alice',
      pwaPasswordHash: 'supersecret',
      signatureData: 'data:image/png;base64,AAAA',
      accessCode: '123456',
      linkToken: 'abc123',
      tokenHash: 'deadbeef',
      confirmationToken: 'tok',
      witnessSignatureData: 'data:image/png;base64,BBBB',
    }
    const out = redactForAudit(row)
    expect(out).toEqual({ id: 'p1', name: 'Alice' })
  })

  it('does not mutate input', () => {
    const row = { id: 'p1', pwaPasswordHash: 'x', name: 'Alice' }
    const out = redactForAudit(row)
    expect(row.pwaPasswordHash).toBe('x') // original untouched
    expect(out).not.toHaveProperty('pwaPasswordHash')
  })
})
