/**
 * F23 — `denyUnless` / `hasAnyPermission`: "may this person use this endpoint, from this app?"
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.12).
 *
 * Every endpoint that used to check only for a session now states a rule: the apps that may call
 * it and the module permissions that serve it (any ONE is enough). The real-stack matrix
 * (tests/integration/session-only-endpoints.test.ts) proves each endpoint against the real
 * roles; this file pins the helper itself with the permission engine and the app detection
 * stubbed, so the order of the checks and the any-one rule cannot drift unseen, including the
 * parts the real roles cannot show (a role that holds a permission on the wrong app).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ resolveAppScope: vi.fn(), checkPermission: vi.fn() }))

vi.mock('../../src/rbac/middleware/detectInterface', () => ({
  resolveAppScope: mocks.resolveAppScope,
}))
vi.mock('../../src/lib/rbac', () => ({ checkPermission: mocks.checkPermission }))

import { denyUnless, hasAnyPermission } from '../../src/lib/route-access'

const c = { json: vi.fn((body: unknown, status: number) => ({ body, status })) }
const ctx = c as never
const REFUSED = { body: { error: 'Unauthorized' }, status: 403 }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveAppScope.mockReturnValue('portal')
  mocks.checkPermission.mockResolvedValue(true)
})

describe('hasAnyPermission', () => {
  it('is false for an empty list, and asks nothing', async () => {
    expect(await hasAnyPermission(ctx, 'u1', [])).toBe(false)
    expect(mocks.checkPermission).not.toHaveBeenCalled()
  })

  it('is true as soon as ONE of the pairs is held, and stops asking', async () => {
    mocks.checkPermission.mockImplementation(
      async (_c: unknown, _u: string, module: string) => module === 'b'
    )
    const held = await hasAnyPermission(ctx, 'u1', [
      ['a', 'read'],
      ['b', 'read'],
      ['c', 'read'],
    ])
    expect(held).toBe(true)
    expect(mocks.checkPermission.mock.calls.map((call) => call[2])).toEqual(['a', 'b'])
  })

  it('is false when none is held', async () => {
    mocks.checkPermission.mockResolvedValue(false)
    expect(
      await hasAnyPermission(ctx, 'u1', [
        ['a', 'read'],
        ['b', 'update'],
      ])
    ).toBe(false)
    expect(mocks.checkPermission).toHaveBeenCalledTimes(2)
  })

  it('passes the request, the user, the module and the action to the engine', async () => {
    await hasAnyPermission(ctx, 'u1', [['patients', 'update']])
    expect(mocks.checkPermission).toHaveBeenCalledWith(ctx, 'u1', 'patients', 'update')
  })
})

describe('denyUnless — apps', () => {
  it('refuses an app that is not listed, even for someone holding every permission', async () => {
    mocks.resolveAppScope.mockReturnValue('pwa')
    const denied = await denyUnless(ctx, 'u1', { apps: ['portal'], anyOf: [['analytics', 'read']] })
    expect(denied).toEqual(REFUSED)
    expect(mocks.checkPermission).not.toHaveBeenCalled()
  })

  it.each(['portal', 'hr'] as const)('lets a listed app through (%s)', async (app) => {
    mocks.resolveAppScope.mockReturnValue(app)
    expect(
      await denyUnless(ctx, 'u1', { apps: ['portal', 'hr'], anyOf: [['staff', 'read']] })
    ).toBeNull()
  })

  it('accepts any app when none are listed, but the permission still applies', async () => {
    mocks.resolveAppScope.mockReturnValue('pwa')
    expect(await denyUnless(ctx, 'u1', { anyOf: [['staff', 'read']] })).toBeNull()
    mocks.checkPermission.mockResolvedValue(false)
    expect(await denyUnless(ctx, 'u1', { anyOf: [['staff', 'read']] })).toEqual(REFUSED)
  })
})

describe('denyUnless — permissions', () => {
  it('refuses a person who holds none of the listed permissions', async () => {
    mocks.checkPermission.mockResolvedValue(false)
    const denied = await denyUnless(ctx, 'u1', {
      apps: ['portal'],
      anyOf: [
        ['inventory', 'read'],
        ['items', 'read'],
      ],
    })
    expect(denied).toEqual(REFUSED)
  })

  it('lets a person in who holds ANY one of them, not all of them', async () => {
    mocks.checkPermission.mockImplementation(
      async (_c: unknown, _u: string, module: string) => module === 'items'
    )
    expect(
      await denyUnless(ctx, 'u1', {
        apps: ['portal'],
        anyOf: [
          ['inventory', 'read'],
          ['items', 'read'],
          ['settings', 'read'],
        ],
      })
    ).toBeNull()
  })

  it('needs no permission when the rule lists none (apps only)', async () => {
    expect(await denyUnless(ctx, 'u1', { apps: ['portal'] })).toBeNull()
    expect(await denyUnless(ctx, 'u1', { apps: ['portal'], anyOf: [] })).toBeNull()
    expect(mocks.checkPermission).not.toHaveBeenCalled()
  })

  it('answers with a 403 the route can return as it is', async () => {
    mocks.checkPermission.mockResolvedValue(false)
    await denyUnless(ctx, 'u1', { anyOf: [['staff', 'read']] })
    expect(c.json).toHaveBeenCalledWith({ error: 'Unauthorized' }, 403)
  })
})

describe('denyUnless — openIn (apps where being signed in is enough)', () => {
  const rule = { apps: ['portal', 'pwa'], openIn: ['pwa'], anyOf: [['staff', 'read']] } as const

  it('lets a signed-in person in from an open app without asking the engine', async () => {
    mocks.resolveAppScope.mockReturnValue('pwa')
    mocks.checkPermission.mockResolvedValue(false)
    expect(await denyUnless(ctx, 'u1', rule)).toBeNull()
    expect(mocks.checkPermission).not.toHaveBeenCalled()
  })

  it('still asks for the permission from an app that is not open', async () => {
    mocks.resolveAppScope.mockReturnValue('portal')
    mocks.checkPermission.mockResolvedValue(false)
    expect(await denyUnless(ctx, 'u1', rule)).toEqual(REFUSED)
    expect(mocks.checkPermission).toHaveBeenCalledTimes(1)
  })

  it('does not open an app that the rule does not list at all', async () => {
    mocks.resolveAppScope.mockReturnValue('hr')
    expect(await denyUnless(ctx, 'u1', rule)).toEqual(REFUSED)
  })
})
