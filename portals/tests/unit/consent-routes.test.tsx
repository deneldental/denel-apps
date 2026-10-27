/**
 * F06 / F07 / F08 — the Consents routes. See
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (Step 5), decisions D5.
 *
 * Runs the consent module's real route table; only the pages (which fetch data) are
 * stubbed, so what is checked is the routing the module itself declares.
 *
 *  F06  the legacy `/ortho-consent/:patientId` redirect sent people to the literal
 *       text `/consents/ortho/:patientId` (React Router does not substitute the
 *       parameter), where the detail page found no such record and bounced to the list.
 *  F07  a doctor had no way into ortho consent at all: no sidebar entry.
 *  F08  the Templates tab led to actions that opened `/documents…`, a route that was
 *       deliberately removed (D5: hide it until Documents v3 is in scope).
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Outlet, Routes, useLocation, useParams } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/features/consent-management/consent-layout', () => ({
  ConsentLayout: () => <Outlet />,
}))
vi.mock('@/features/consent-management/pages/index', () => ({ default: () => <div>page:all</div> }))
vi.mock('@/features/consent-management/pages/ortho', () => ({
  default: () => <div>page:ortho-list</div>,
}))
vi.mock('@/features/consent-management/pages/pending', () => ({
  default: () => <div>page:pending</div>,
}))
vi.mock('@/features/consent-management/pages/sign', () => ({ default: () => <div>page:sign</div> }))
vi.mock('@/features/consent-management/pages/surgical', () => ({
  default: () => <div>page:surgical</div>,
}))
vi.mock('@/features/consent-management/pages/templates', () => ({
  default: () => <div>page:templates</div>,
}))
vi.mock('@/features/ortho-consent/pages/detail', () => ({
  default: function OrthoDetail() {
    const { patientId } = useParams()
    return <div>detail:{patientId}</div>
  },
}))

import { consentManagementModule } from '@/app/modules/consent-management'
import { navItemsAllowed } from '@/app/route-access'

function Where() {
  const { pathname } = useLocation()
  return <output data-testid="where">{pathname}</output>
}

function visit(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>{consentManagementModule.routes}</Routes>
      <Where />
    </MemoryRouter>
  )
  return () => screen.getByTestId('where').textContent
}

describe('F06 — the legacy ortho-consent URL keeps the record', () => {
  it('redirects /ortho-consent/:id to the same id on the canonical URL', () => {
    const where = visit('/ortho-consent/abc-123')
    expect(where()).toBe('/consents/ortho/abc-123')
    expect(screen.getByText('detail:abc-123')).toBeInTheDocument()
  })

  it('never lands on the literal ":patientId"', () => {
    const where = visit('/ortho-consent/7f1c0d3e-0000-4000-8000-000000000001')
    expect(where()).not.toContain(':patientId')
    expect(screen.queryByText('detail::patientId')).not.toBeInTheDocument()
  })

  it('redirects the legacy list URL to the canonical list', () => {
    const where = visit('/ortho-consent')
    expect(where()).toBe('/consents/ortho')
    expect(screen.getByText('page:ortho-list')).toBeInTheDocument()
  })

  it('opens the canonical detail URL directly', () => {
    visit('/consents/ortho/abc-123')
    expect(screen.getByText('detail:abc-123')).toBeInTheDocument()
  })
})

describe('F08 — the Templates page is not reachable (D5)', () => {
  it('does not route /consents/templates to the templates page', () => {
    const where = visit('/consents/templates')
    expect(screen.queryByText('page:templates')).not.toBeInTheDocument()
    expect(where()).toBe('/consents')
  })

  it('sends the old consent-library URL to the Consents home, not the templates page', () => {
    const where = visit('/compliance/consent-library')
    expect(screen.queryByText('page:templates')).not.toBeInTheDocument()
    expect(where()).toBe('/consents')
  })

  it('keeps the working signing path', () => {
    visit('/consents/sign')
    expect(screen.getByText('page:sign')).toBeInTheDocument()
  })

  it('keeps the other consent pages', () => {
    visit('/consents/pending')
    expect(screen.getByText('page:pending')).toBeInTheDocument()
  })
})

describe('F07 — a doctor has a way into ortho consent', () => {
  const can =
    (granted: string[]) =>
    (module: string, action: string): boolean =>
      action === 'read' && granted.includes(module)
  const hasAccess = consentManagementModule.hasAccess as (
    can: (module: string, action: string) => boolean
  ) => boolean

  it('offers one sidebar entry, to the ortho list', () => {
    expect(consentManagementModule.navItems.map((i) => [i.label, i.to])).toEqual([
      ['Ortho Consent', '/consents/ortho'],
    ])
  })

  it('shows it to a doctor (ortho_consent, no compliance)', () => {
    expect(hasAccess(can(['patients', 'medical_records', 'ortho_consent']))).toBe(true)
  })

  // Decision D13: reception, who hold ortho_consent (and compliance and messaging),
  // get the entry too. They had no menu path to these pages at all.
  it('shows it to reception too (D13)', () => {
    expect(hasAccess(can(['ortho_consent', 'compliance', 'messaging']))).toBe(true)
  })

  it('shows it to anyone holding ortho_consent, whatever else they hold', () => {
    expect(hasAccess(can(['ortho_consent', 'compliance']))).toBe(true)
    expect(hasAccess(can(['ortho_consent', 'messaging']))).toBe(true)
  })

  it('shows it to nobody without ortho_consent', () => {
    expect(hasAccess(can(['patients', 'appointments']))).toBe(false)
    expect(hasAccess(can(['compliance']))).toBe(false)
  })

  it('is a link the route guard lets that doctor open', () => {
    const doctor = ['dashboard', 'patients', 'ortho_consent']
    expect(navItemsAllowed(consentManagementModule.navItems, doctor).map((i) => i.to)).toEqual([
      '/consents/ortho',
    ])
    // …and not one offered to a user the guard would bounce.
    expect(navItemsAllowed(consentManagementModule.navItems, ['patients'])).toEqual([])
  })
})
