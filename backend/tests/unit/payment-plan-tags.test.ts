/**
 * G07 — the pure rule that decides which plan a payment belongs to. See
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.11). The runtime and the backfill both call
 * `resolvePlanTag`, so these cases are the single definition of "this is plan money".
 */
import { describe, expect, it } from 'vitest'
import { type PlanIdsByInvoice, resolvePlanTag } from '../../src/lib/payment-plan-tags'

const owners = (entries: Record<string, string[]>): PlanIdsByInvoice =>
  new Map(Object.entries(entries).map(([inv, plans]) => [inv, new Set(plans)]))

const inv = (targetId: string) => ({ targetType: 'invoice', targetId })

describe('resolvePlanTag', () => {
  it('returns the plan when the only allocation pays that plan', () => {
    expect(resolvePlanTag([inv('master-a')], owners({ 'master-a': ['plan-a'] }))).toBe('plan-a')
  })

  it('returns the plan when several allocations all pay the same plan', () => {
    const map = owners({ 'master-a': ['plan-a'], 'child-a': ['plan-a'] })
    expect(resolvePlanTag([inv('master-a'), inv('child-a')], map)).toBe('plan-a')
  })

  it('returns null with no allocations (a deposit)', () => {
    expect(resolvePlanTag([], owners({}))).toBeNull()
  })

  it('returns null when an allocation pays an invoice that belongs to no plan', () => {
    expect(resolvePlanTag([inv('one-off')], owners({}))).toBeNull()
  })

  it('returns null when the payment also pays an ordinary invoice', () => {
    const map = owners({ 'master-a': ['plan-a'] })
    expect(resolvePlanTag([inv('master-a'), inv('one-off')], map)).toBeNull()
  })

  it('returns null when the allocations pay two different plans', () => {
    const map = owners({ 'master-a': ['plan-a'], 'master-b': ['plan-b'] })
    expect(resolvePlanTag([inv('master-a'), inv('master-b')], map)).toBeNull()
  })

  it('returns null when one invoice is claimed by two plans (ambiguous)', () => {
    expect(resolvePlanTag([inv('shared')], owners({ shared: ['plan-a', 'plan-b'] }))).toBeNull()
  })

  it('returns null when an allocation is not to an invoice', () => {
    const map = owners({ 'master-a': ['plan-a'] })
    const bill = { targetType: 'bill', targetId: 'some-bill' }
    expect(resolvePlanTag([inv('master-a'), bill], map)).toBeNull()
    expect(resolvePlanTag([bill], map)).toBeNull()
  })

  it('never reads a non-invoice allocation as an invoice, even when the ids collide', () => {
    const map = owners({ 'master-a': ['plan-a'] })
    expect(resolvePlanTag([{ targetType: 'bill', targetId: 'master-a' }], map)).toBeNull()
  })

  it('treats an invoice mapped to an empty set as belonging to no plan', () => {
    expect(resolvePlanTag([inv('x')], owners({ x: [] }))).toBeNull()
  })

  it('counts the same invoice twice as one plan', () => {
    const map = owners({ 'master-a': ['plan-a'] })
    expect(resolvePlanTag([inv('master-a'), inv('master-a')], map)).toBe('plan-a')
  })
})
