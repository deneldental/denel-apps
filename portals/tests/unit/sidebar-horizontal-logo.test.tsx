/**
 * Brand Assets promises: collapsed sidebar shows the square icon, expanded
 * sidebar shows the horizontal logo. The expanded half was never wired — the
 * sidebar always rendered icon + short name, ignoring an uploaded horizontal
 * logo (the preview on the Brand Assets tab showed it, the real sidebar not).
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  branding: {} as Record<string, unknown>,
}))

vi.mock('@/lib/branding-context', () => ({ useBranding: () => state.branding }))
vi.mock('@/shared/hooks/use-module-visibility', () => ({
  useModuleVisibility: () => ({ hiddenIds: new Set(), isLoading: false }),
}))
vi.mock('@/app/modules/registry', () => ({ getAllNavItems: () => [] }))

import { Sidebar } from '@/features/dashboard/components/sidebar'

const HORIZONTAL = 'https://pub-test.r2.dev/SYS/branding/logo-horizontal.png'
const ICON = 'https://pub-test.r2.dev/SYS/branding/logo-icon.png'

function renderSidebar(isCollapsed: boolean) {
  return render(
    <MemoryRouter>
      <Sidebar
        isCollapsed={isCollapsed}
        toggleCollapse={() => {}}
        user={{ roleId: 'admin' }}
        permissions={{ isAdmin: true, accessibleModules: [], roleId: 'admin' }}
      />
    </MemoryRouter>
  )
}

const images = () =>
  Array.from(document.querySelectorAll('img')).map((img) => img.getAttribute('src'))

describe('Sidebar branding', () => {
  it('expanded shows the horizontal logo when one is uploaded', () => {
    state.branding = { logoHorizontalUrl: HORIZONTAL, logoIconUrl: ICON, shortName: 'Denel' }
    renderSidebar(false)

    expect(images()).toContain(HORIZONTAL)
    expect(screen.queryByText('Denel')).not.toBeInTheDocument()
  })

  it('expanded falls back to icon + short name without a horizontal logo', () => {
    state.branding = { logoHorizontalUrl: null, logoIconUrl: ICON, shortName: 'Denel' }
    renderSidebar(false)

    expect(images()).toContain(ICON)
    expect(screen.getByText('Denel')).toBeInTheDocument()
  })

  it('collapsed keeps the square icon even when a horizontal logo exists', () => {
    state.branding = { logoHorizontalUrl: HORIZONTAL, logoIconUrl: ICON, shortName: 'Denel' }
    renderSidebar(true)

    expect(images()).toContain(ICON)
    expect(images()).not.toContain(HORIZONTAL)
  })
})
