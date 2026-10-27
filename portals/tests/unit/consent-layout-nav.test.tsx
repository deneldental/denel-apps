/**
 * F07 / F08 — what the Consents sub-navigation offers each user. See
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (Step 5).
 *
 * The layout listed every tab to everyone, including tabs the route guard would
 * refuse a doctor (they hold ortho_consent, not compliance) and a Templates tab whose
 * actions lead to removed pages (D5).
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ConsentLayout } from '@/features/consent-management/consent-layout'
import { type PermissionsPayload, PermissionsProvider } from '@/lib/permissions-context'

function renderLayout(payload: PermissionsPayload) {
  render(
    <PermissionsProvider value={payload}>
      <MemoryRouter initialEntries={['/consents/ortho']}>
        <Routes>
          <Route element={<ConsentLayout />}>
            <Route path="/consents/ortho" element={<div>content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </PermissionsProvider>
  )
}

const linkLabels = () =>
  screen
    .getAllByRole('link')
    .map((a) => a.textContent?.trim())
    .filter(Boolean)

const base = { scopes: ['portal'], roleId: null }

describe('Consents sub-navigation', () => {
  it('shows a doctor only the ortho page they can open', () => {
    renderLayout({
      ...base,
      isAdmin: false,
      accessibleModules: ['dashboard', 'patients', 'ortho_consent'],
    })
    expect(linkLabels()).toEqual(['Ortho'])
  })

  it('shows reception the pages they can open, without Templates', () => {
    renderLayout({
      ...base,
      isAdmin: false,
      accessibleModules: ['ortho_consent', 'compliance', 'messaging'],
    })
    expect(linkLabels()).toEqual(['All Consents', 'Pending', 'Ortho', 'Surgical', 'Sign'])
  })

  it('shows an admin everything that is still in use, without Templates', () => {
    renderLayout({ ...base, isAdmin: true, accessibleModules: [] })
    expect(linkLabels()).toEqual(['All Consents', 'Pending', 'Ortho', 'Surgical', 'Sign'])
  })

  it('never offers Templates, to anyone (D5)', () => {
    renderLayout({ ...base, isAdmin: true, accessibleModules: [] })
    expect(screen.queryByRole('link', { name: /templates/i })).not.toBeInTheDocument()
  })

  it('shows a compliance holder without ortho_consent no Ortho tab', () => {
    renderLayout({ ...base, isAdmin: false, accessibleModules: ['compliance'] })
    expect(linkLabels()).toEqual(['All Consents', 'Pending', 'Surgical', 'Sign'])
  })
})
