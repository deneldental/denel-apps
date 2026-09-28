/**
 * The route guard (DashboardLayout) and the sidebar / mobile nav share one
 * rule for which pages a user may open (src/app/route-access.ts).
 *
 * The bug this locks down: modules without a `permission` — Patient Records,
 * Scheduling — were listed in the sidebar for everyone, while the guard
 * required the page's module and silently bounced every click back to the
 * dashboard. A receptionist account that lacked the module saw the link and
 * could never open it.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { NavItem } from '@/app/modules/types'
import {
  getModuleForPath,
  isPortalPathAllowed,
  navItemsAllowed,
  PORTAL_HOME,
} from '@/app/route-access'

const Icon = () => null

describe('getModuleForPath', () => {
  it('maps a prefix and everything under it', () => {
    expect(getModuleForPath('/patients')).toBe('patients')
    expect(getModuleForPath('/patients/123/cases/9')).toBe('patients')
    expect(getModuleForPath('/appointments/reminders')).toBe('appointments')
  })

  it('prefers the longest prefix', () => {
    expect(getModuleForPath('/finance/payroll')).toBe('payroll')
    expect(getModuleForPath('/finance/tax-configuration')).toBe('tax_calculations')
  })

  it('ignores the query string and hash', () => {
    expect(getModuleForPath('/patients?tab=archived')).toBe('patients')
    expect(getModuleForPath('/labs#open')).toBe('labs')
  })

  it('returns null for a path no prefix maps', () => {
    expect(getModuleForPath('/nowhere')).toBeNull()
  })
})

describe('isPortalPathAllowed', () => {
  it('lets an admin open anything, mapped or not', () => {
    expect(isPortalPathAllowed('/finance/payroll', null)).toBe(true)
    expect(isPortalPathAllowed('/nowhere', null)).toBe(true)
  })

  it('always allows the home page — the guard never bounces it', () => {
    expect(isPortalPathAllowed(PORTAL_HOME, [])).toBe(true)
  })

  it("requires the page's module otherwise", () => {
    expect(isPortalPathAllowed('/patients', ['patients'])).toBe(true)
    expect(isPortalPathAllowed('/patients', ['appointments'])).toBe(false)
    expect(isPortalPathAllowed('/finance/payroll', ['payments'])).toBe(false)
  })

  it('denies an unmapped path to non-admins (fail closed)', () => {
    expect(isPortalPathAllowed('/nowhere', ['patients', 'appointments'])).toBe(false)
  })
})

describe('navItemsAllowed', () => {
  const items: NavItem[] = [
    { label: 'Overview', to: '/dashboard', icon: Icon },
    { label: 'Patient Records', to: '/patients', icon: Icon },
    { label: 'Scheduling', to: '/appointments', icon: Icon },
    {
      label: 'Money',
      to: '/payments',
      icon: Icon,
      children: [
        { label: 'Payments', to: '/payments' },
        { label: 'Payroll', to: '/finance/payroll' },
      ],
    },
  ]
  const labels = (list: NavItem[]) => list.map((i) => i.label)

  it('offers only links the guard lets the user open', () => {
    const allowed = navItemsAllowed(items, ['dashboard', 'appointments'])
    expect(labels(allowed)).toEqual(['Overview', 'Scheduling'])
  })

  it('keeps a group with only its reachable children', () => {
    const allowed = navItemsAllowed(items, ['payments'])
    const money = allowed.find((i) => i.label === 'Money')
    expect(money?.children?.map((c) => c.label)).toEqual(['Payments'])
  })

  it('drops a group when none of its children are reachable', () => {
    expect(labels(navItemsAllowed(items, ['patients']))).toEqual(['Overview', 'Patient Records'])
  })

  it('leaves the admin list untouched', () => {
    expect(navItemsAllowed(items, null)).toEqual(items)
  })
})

describe('every sidebar link in a registered module is guarded', () => {
  // Read from source, like module-visibility-toggles.test.ts: importing the
  // registry would pull in every page. An unmapped link is now hidden from
  // every non-admin (the guard would deny it), so a missing map entry must
  // fail here rather than quietly remove a menu item.
  const modulesDir = resolve(__dirname, '../../src/app/modules')
  const registry = readFileSync(join(modulesDir, 'registry.ts'), 'utf8')
  const registered = [...registry.matchAll(/from '\.\/([a-z-]+)'/g)]
    .map((m) => m[1])
    .filter((name) => name !== 'types')

  it('finds the registered modules', () => {
    expect(registered).toContain('patients')
    expect(registered).toContain('scheduling')
    expect(registered.length).toBeGreaterThan(15)
  })

  it('maps each link target to a guard module', () => {
    const files = new Set(readdirSync(modulesDir))
    const unmapped: string[] = []
    for (const name of registered) {
      expect(files.has(`${name}.tsx`), `${name}.tsx exists`).toBe(true)
      const source = readFileSync(join(modulesDir, `${name}.tsx`), 'utf8')
      for (const [, to] of source.matchAll(/\bto:\s*'([^']+)'/g)) {
        if (to !== PORTAL_HOME && getModuleForPath(to) === null) unmapped.push(`${name}: ${to}`)
      }
    }
    expect(unmapped).toEqual([])
  })

  it('declares permissions on Patient Records and Scheduling', () => {
    const read = (name: string) => readFileSync(join(modulesDir, `${name}.tsx`), 'utf8')
    expect(read('patients')).toContain("permission: 'patients'")
    expect(read('scheduling')).toContain("permission: 'appointments'")
  })
})
