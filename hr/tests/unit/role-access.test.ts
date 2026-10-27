/**
 * The decisions behind the HR screens that hand out roles and first passwords
 * (D15 / D16): what a person may be offered, what a role control shows, and when a registration
 * can be approved. Pure functions, so they run without a browser.
 *
 * The server enforces every one of these rules independently
 * (backend/tests/integration/role-assignment-authority.test.ts); these tests pin that the screens
 * offer exactly what the server will accept, and nothing it will refuse.
 */
import { describe, expect, it } from 'vitest'
import { roleOptionsFor } from '@/features/staff/__mock__/team-members'
import {
  approvalAccess,
  MIN_FIRST_PASSWORD,
  roleControlFor,
  wizardRoleOptions,
} from '@/features/staff/role-access'

const ids = (options: ReadonlyArray<{ value: string }>) => options.map((o) => o.value).sort()

describe('which roles a person is offered', () => {
  it('an administrator is offered every assignable role, and never doctor', () => {
    expect(ids(roleOptionsFor(true))).toEqual(
      ['admin', 'external_trainer', 'hr_admin', 'lab_technician', 'receptionist', 'staff'].sort()
    )
  })

  it('an HR administrator is offered only staff, receptionist and lab technician', () => {
    expect(ids(roleOptionsFor(false))).toEqual(['lab_technician', 'receptionist', 'staff'])
  })

  it('the Add Staff wizard offers the same sets, with its own hints', () => {
    const all = wizardRoleOptions(true)
    expect(ids(all)).toEqual(ids(roleOptionsFor(true)))
    expect(ids(wizardRoleOptions(false))).toEqual(ids(roleOptionsFor(false)))
    for (const option of all) expect(option.hint.length).toBeGreaterThan(0)
  })
})

describe('what the role control on Edit access shows', () => {
  it('lets an administrator edit any role except doctor', () => {
    for (const role of [null, 'staff', 'receptionist', 'admin', 'hr_admin', 'external_trainer']) {
      expect(roleControlFor(role, true), String(role)).toEqual({ kind: 'editable' })
    }
  })

  it('shows doctor read-only to everyone, pointing at Specialists', () => {
    for (const canAssignAny of [true, false]) {
      expect(roleControlFor('doctor', canAssignAny)).toEqual({
        kind: 'specialist-only',
        label: 'Doctor',
      })
    }
  })

  it('lets an HR administrator edit people who hold an everyday role or none', () => {
    for (const role of [null, undefined, 'staff', 'receptionist', 'lab_technician']) {
      expect(roleControlFor(role, false), String(role)).toEqual({ kind: 'editable' })
    }
  })

  it.each([
    ['admin', 'Admin'],
    ['hr_admin', 'HR Administrator'],
    ['external_trainer', 'External Trainer'],
  ])('shows %s read-only to an HR administrator', (role, label) => {
    expect(roleControlFor(role, false)).toEqual({ kind: 'admin-only', label })
  })

  it('shows an unrecognised role read-only to an HR administrator, as it is', () => {
    expect(roleControlFor('some_custom_role', false)).toEqual({
      kind: 'admin-only',
      label: 'some_custom_role',
    })
  })
})

describe('when a registration can be approved', () => {
  const email = 'new.hire@clinic.test'
  const strong = 'x'.repeat(MIN_FIRST_PASSWORD)

  it('a Team-app-only role, or no role, needs nothing more and sends no password', () => {
    for (const role of ['none', 'staff', 'lab_technician']) {
      const a = approvalAccess({ role, registrantEmail: '', initialPassword: 'ignored' })
      expect(a, role).toEqual({
        needsPassword: false,
        missingEmail: false,
        passwordTooShort: false,
        canApprove: true,
        passwordToSend: undefined,
      })
    }
  })

  it.each([
    'receptionist',
    'admin',
    'hr_admin',
    'external_trainer',
  ])('%s needs an e-mail and a first password of the minimum length', (role) => {
    expect(approvalAccess({ role, registrantEmail: email, initialPassword: '' }).canApprove).toBe(
      false
    )
    expect(
      approvalAccess({ role, registrantEmail: email, initialPassword: strong.slice(1) }).canApprove
    ).toBe(false)
    const ok = approvalAccess({ role, registrantEmail: email, initialPassword: strong })
    expect(ok.canApprove).toBe(true)
    expect(ok.passwordToSend).toBe(strong)
  })

  it('cannot be approved for a password role when the registrant gave no e-mail, whatever the password', () => {
    const a = approvalAccess({
      role: 'receptionist',
      registrantEmail: '   ',
      initialPassword: strong,
    })
    expect(a.missingEmail).toBe(true)
    expect(a.canApprove).toBe(false)
  })

  it('reports a too-short password only for a role that needs one', () => {
    expect(
      approvalAccess({ role: 'receptionist', registrantEmail: email, initialPassword: 'short' })
        .passwordTooShort
    ).toBe(true)
    expect(
      approvalAccess({ role: 'staff', registrantEmail: email, initialPassword: 'short' })
        .passwordTooShort
    ).toBe(false)
  })

  it('the minimum matches the backend policy', () => {
    expect(MIN_FIRST_PASSWORD).toBe(12)
  })
})
