/**
 * F22 / D9 — `authorizeUpload`: may THIS person upload THIS kind of file, from the app they are
 * using? See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.12).
 *
 * The real-stack test (tests/integration/upload-access.test.ts) signs in as the real roles. A
 * role that holds a permission but is on the wrong app is hard to find there (the permission
 * engine is itself app-aware, and an administrator is let through everywhere), so the ORDER of
 * the checks is pinned here with the permission engine and the database stubbed: the app a kind
 * belongs to is decided first and cannot be bought with a permission.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveAppScope: vi.fn(),
  hasAnyPermission: vi.fn(),
  findFirst: vi.fn(),
}))

vi.mock('../../src/rbac/middleware/detectInterface', () => ({
  resolveAppScope: mocks.resolveAppScope,
}))
vi.mock('../../src/lib/route-access', () => ({ hasAnyPermission: mocks.hasAnyPermission }))
vi.mock('../../src/db', () => ({
  getDb: () => ({ query: { staff: { findFirst: mocks.findFirst } } }),
}))

import { authorizeUpload } from '../../src/lib/upload-access'
import { UPLOAD_KINDS, type UploadKind, type UploadKindId } from '../../src/lib/upload-policy'

const c = {} as never
const user = { id: 'user-1' } as never
const APPS = ['portal', 'pwa', 'hr'] as const

const kind = (id: UploadKindId): UploadKind => {
  const found = UPLOAD_KINDS.find((k) => k.id === id)
  if (!found) throw new Error(`no such kind: ${id}`)
  return found
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveAppScope.mockReturnValue('portal')
  mocks.hasAnyPermission.mockResolvedValue(true)
  mocks.findFirst.mockResolvedValue({ id: 'staff-1' })
})

describe('authorizeUpload — the app a kind belongs to is decided first', () => {
  const wrongApp = UPLOAD_KINDS.flatMap((k) =>
    APPS.filter((a) => !k.apps.includes(a)).map((a) => [k.id, a] as const)
  )
  const rightApp = UPLOAD_KINDS.flatMap((k) => k.apps.map((a) => [k.id, a] as const))

  it('has both kinds of case to check', () => {
    expect(wrongApp.length).toBeGreaterThan(20)
    expect(rightApp.length).toBeGreaterThan(20)
  })

  it.each(
    wrongApp
  )('refuses %s from the %s app, even for someone who holds every permission', async (id, app) => {
    mocks.resolveAppScope.mockReturnValue(app)
    const result = await authorizeUpload(c, user, kind(id))
    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/cannot be uploaded from this app/i),
    })
    // neither the permission engine nor the staff table is asked about a kind the app cannot use
    expect(mocks.hasAnyPermission).not.toHaveBeenCalled()
    expect(mocks.findFirst).not.toHaveBeenCalled()
  })

  it.each(rightApp)('lets %s in from the %s app for someone who is allowed', async (id, app) => {
    mocks.resolveAppScope.mockReturnValue(app)
    const result = await authorizeUpload(c, user, kind(id))
    expect(result.ok).toBe(true)
  })
})

describe('authorizeUpload — kinds that need a permission', () => {
  it('refuses when the person holds none of the permissions the kind lists', async () => {
    mocks.hasAnyPermission.mockResolvedValue(false)
    const xrays = kind('patient-xrays')
    const result = await authorizeUpload(c, user, xrays)
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/permission/i) })
    expect(mocks.hasAnyPermission).toHaveBeenCalledWith(
      c,
      'user-1',
      xrays.need.type === 'permission' ? xrays.need.anyOf : []
    )
  })

  it('lets the person in when the engine says one of them is held', async () => {
    const result = await authorizeUpload(c, user, kind('patient-xrays'))
    expect(result).toEqual({ ok: true })
  })

  it.each(
    UPLOAD_KINDS.filter((k) => k.need.type === 'permission').map((k) => k.id)
  )('asks the engine about %s with that kind’s own list, not a shared one', async (id) => {
    const k = kind(id)
    mocks.resolveAppScope.mockReturnValue(k.apps[0])
    await authorizeUpload(c, user, k)
    expect(mocks.hasAnyPermission).toHaveBeenCalledTimes(1)
    expect(mocks.hasAnyPermission.mock.calls[0][2]).toBe(
      k.need.type === 'permission' ? k.need.anyOf : null
    )
  })
})

describe('authorizeUpload — the self-scoped kinds', () => {
  it('lets anyone signed in use their own misc area, with no permission asked', async () => {
    const result = await authorizeUpload(c, user, kind('personal-misc'))
    expect(result).toEqual({ ok: true })
    expect(mocks.hasAnyPermission).not.toHaveBeenCalled()
  })

  it('finds the Team app’s own area through the staff record linked to the login', async () => {
    mocks.resolveAppScope.mockReturnValue('pwa')
    const result = await authorizeUpload(c, user, kind('team-requests'))
    expect(result).toEqual({ ok: true, staffId: 'staff-1' })
    expect(mocks.findFirst).toHaveBeenCalledTimes(1)
    expect(mocks.hasAnyPermission).not.toHaveBeenCalled()
  })

  it('refuses a Team-app login with no staff record, instead of failing', async () => {
    mocks.resolveAppScope.mockReturnValue('pwa')
    mocks.findFirst.mockResolvedValue(undefined)
    const result = await authorizeUpload(c, user, kind('team-requests'))
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/staff record/i) })
  })
})
