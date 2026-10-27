/**
 * Who may give which role, and who signs in with a password (decisions D15 / D16).
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.10).
 *
 * These are the shared rules the backend enforces and the HR screens use to decide what
 * to offer, so one definition cannot drift from the other. Pure functions, no database.
 *
 * The role vocabulary comes from the real config (SYSTEM_ROLES), so a role added there
 * but not decided here fails the "every role is classified" test instead of silently
 * becoming assignable.
 */
import {
  assignableRoleIds,
  canDelegateRoleChange,
  HR_ASSIGNABLE_ROLES,
  ROLE_SCOPES,
  roleSignsInWithPassword,
} from '@denel/rbac'
import { describe, expect, it } from 'vitest'
import { SYSTEM_ROLES } from '../../src/config/roles.config'

const EVERYDAY = ['staff', 'receptionist', 'lab_technician']
const ADMIN_ONLY = ['admin', 'hr_admin', 'doctor', 'external_trainer']

describe('HR administrators may assign only the everyday roles (D15)', () => {
  it('the delegated set is exactly staff, receptionist and lab technician', () => {
    expect([...HR_ASSIGNABLE_ROLES].sort()).toEqual([...EVERYDAY].sort())
  })

  it('every system role is classified one way or the other', () => {
    for (const role of SYSTEM_ROLES.map((r) => r.id)) {
      expect(
        EVERYDAY.includes(role) || ADMIN_ONLY.includes(role),
        `role "${role}" is neither an everyday role nor decided admin-only`
      ).toBe(true)
    }
  })

  it.each(
    EVERYDAY.flatMap((from) => EVERYDAY.map((to) => [from, to]))
  )('lets them move %s to %s', (from, to) => expect(canDelegateRoleChange(from, to)).toBe(true))

  it('lets them give a role to someone who has none, and take it away again', () => {
    expect(canDelegateRoleChange(null, 'receptionist')).toBe(true)
    expect(canDelegateRoleChange(undefined, 'staff')).toBe(true)
    expect(canDelegateRoleChange('receptionist', null)).toBe(true)
  })

  it.each(ADMIN_ONLY)('refuses to give the %s role', (role) => {
    expect(canDelegateRoleChange(null, role)).toBe(false)
    expect(canDelegateRoleChange('staff', role)).toBe(false)
  })

  it.each(ADMIN_ONLY)('refuses to change someone who currently holds %s', (role) => {
    // Otherwise "set them to receptionist" would demote an administrator.
    expect(canDelegateRoleChange(role, 'receptionist')).toBe(false)
    expect(canDelegateRoleChange(role, null)).toBe(false)
  })

  it('refuses an unknown role either way', () => {
    expect(canDelegateRoleChange(null, 'superuser')).toBe(false)
    expect(canDelegateRoleChange('superuser', 'staff')).toBe(false)
  })

  it('offers an administrator every assignable role and an HR administrator only the everyday ones', () => {
    expect([...assignableRoleIds(true)].sort()).toEqual(
      ['admin', 'hr_admin', 'external_trainer', 'lab_technician', 'receptionist', 'staff'].sort()
    )
    expect([...assignableRoleIds(false)].sort()).toEqual([...EVERYDAY].sort())
  })

  it('never offers the doctor role from the generic pickers, to anyone', () => {
    expect(assignableRoleIds(true)).not.toContain('doctor')
    expect(assignableRoleIds(false)).not.toContain('doctor')
  })
})

describe('who signs in with an e-mail and password (D16)', () => {
  it.each([
    ['admin', true],
    ['hr_admin', true],
    ['doctor', true],
    ['receptionist', true],
    ['external_trainer', true],
    ['lab_technician', false],
    ['staff', false],
  ])('%s → password sign-in: %s', (role, expected) => {
    expect(roleSignsInWithPassword(role)).toBe(expected)
  })

  it('follows the role scopes, not a second list', () => {
    for (const [role, scopes] of Object.entries(ROLE_SCOPES)) {
      expect(roleSignsInWithPassword(role)).toBe(scopes.some((s) => s === 'portal' || s === 'hr'))
    }
  })

  it('an explicit portal or HR grant on top of a Team-only role needs a password too', () => {
    expect(roleSignsInWithPassword('staff', ['pwa'])).toBe(false)
    expect(roleSignsInWithPassword('staff', ['pwa', 'hr'])).toBe(true)
    expect(roleSignsInWithPassword('lab_technician', ['portal'])).toBe(true)
    expect(roleSignsInWithPassword(null, ['hr'])).toBe(true)
  })

  it('no role and no grant means no password sign-in', () => {
    expect(roleSignsInWithPassword(null)).toBe(false)
    expect(roleSignsInWithPassword(undefined, [])).toBe(false)
    expect(roleSignsInWithPassword('nonsense')).toBe(false)
  })
})
