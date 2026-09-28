import { describe, expect, it } from 'vitest'
import { assignBucket, bucketFor, daysOverdue } from '../../src/lib/aging'

const today = new Date('2026-04-15T10:30:00Z')

describe('daysOverdue', () => {
  it('returns 0 when dueDate is null', () => {
    expect(daysOverdue(null, today)).toBe(0)
  })

  it('returns 0 when due today', () => {
    expect(daysOverdue(new Date('2026-04-15'), today)).toBe(0)
  })

  it('returns positive when past due', () => {
    expect(daysOverdue(new Date('2026-04-10'), today)).toBe(5)
  })

  it('returns negative when due in the future', () => {
    expect(daysOverdue(new Date('2026-04-20'), today)).toBe(-5)
  })

  it('ignores time-of-day — floors to whole days', () => {
    const due = new Date('2026-04-14T23:59:59Z')
    expect(daysOverdue(due, today)).toBe(1)
  })
})

describe('bucketFor', () => {
  it('assigns 0 days → current', () => {
    expect(bucketFor(0)).toBe('current')
  })
  it('assigns negative days (future due) → current', () => {
    expect(bucketFor(-10)).toBe('current')
  })
  it('assigns 30 days → current (inclusive)', () => {
    expect(bucketFor(30)).toBe('current')
  })
  it('assigns 31 days → bucket30', () => {
    expect(bucketFor(31)).toBe('bucket30')
  })
  it('assigns 60 days → bucket30 (inclusive)', () => {
    expect(bucketFor(60)).toBe('bucket30')
  })
  it('assigns 61 days → bucket60', () => {
    expect(bucketFor(61)).toBe('bucket60')
  })
  it('assigns 90 days → bucket60 (inclusive)', () => {
    expect(bucketFor(90)).toBe('bucket60')
  })
  it('assigns 91 days → bucket90', () => {
    expect(bucketFor(91)).toBe('bucket90')
  })
  it('assigns 365 days → bucket90', () => {
    expect(bucketFor(365)).toBe('bucket90')
  })
})

describe('assignBucket — combined', () => {
  it('null dueDate → current', () => {
    expect(assignBucket(null, today)).toBe('current')
  })
  it('due today → current', () => {
    expect(assignBucket(new Date('2026-04-15'), today)).toBe('current')
  })
  it('due 45 days ago → bucket30', () => {
    const due = new Date(today)
    due.setDate(due.getDate() - 45)
    expect(assignBucket(due, today)).toBe('bucket30')
  })
  it('due 100 days ago → bucket90', () => {
    const due = new Date(today)
    due.setDate(due.getDate() - 100)
    expect(assignBucket(due, today)).toBe('bucket90')
  })
})
