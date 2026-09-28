/**
 * Unit tests for the RequireRole route guard component.
 *
 * RequireRole is the Team (staff/clinical) PWA's primary auth gate. It:
 *  1. Shows a loading skeleton while staff auth is resolving
 *  2. Allows staff role gates for authenticated staff where roleId matches
 *  3. Uses roleId (RBAC slug) in preference to the coarser Better Auth `role`
 *  4. Handles 'staff' as a meta-role (admin/receptionist/nurse/assistant/staff)
 *  5. Redirects to /login with state.from when no valid session is found
 *
 * The Team app is staff-only — patient self-service (and its `usePatientAuth`
 * gate) was extracted into the separate `patient/` app, so this guard no longer
 * knows about patients.
 *
 * No real auth is involved — useAuth is mocked at the module level so tests
 * exercise the guard logic in pure isolation.
 *
 * Navigate is mocked to render a sentinel div. Without the mock, Navigate inside
 * MemoryRouter with no matching route causes RequireRole to re-render on every
 * location change, looping until OOM.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/auth', () => ({
  useAuth: vi.fn(),
}))

vi.mock('@/shared/components/route-skeleton', () => ({
  RouteSkeleton: () => <div data-testid="route-skeleton">Loading…</div>,
}))

// Navigate is mocked with a sentinel so redirect tests can assert the guard
// fired without triggering the MemoryRouter infinite-re-render loop.
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    Navigate: ({ to }: { to: string }) => <div data-testid="navigate-redirect" data-to={to} />,
  }
})

// ── Imports ───────────────────────────────────────────────────────────────────

import { useAuth } from '@/lib/auth'
import { RequireRole } from '@/shared/components/require-role'

const mockUseAuth = vi.mocked(useAuth)

// ── Helpers ───────────────────────────────────────────────────────────────────

function noStaff() {
  mockUseAuth.mockReturnValue({ user: null, loading: false } as any)
}

function withStaffUser(roleId: string | null, role?: string) {
  mockUseAuth.mockReturnValue({
    user: { id: 'u-1', name: 'Staff', email: 'staff@framada.app', roleId, role: role ?? 'user' },
    loading: false,
  } as any)
}

function renderGuard(roles: string[], { route = '/' } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <RequireRole roles={roles as any}>
        <div data-testid="protected-content">Protected</div>
      </RequireRole>
    </MemoryRouter>
  )
}

// ── Loading state ─────────────────────────────────────────────────────────────

describe('RequireRole — loading state', () => {
  it('renders RouteSkeleton while staff auth is loading', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: true } as any)

    renderGuard(['admin'])

    expect(screen.getByTestId('route-skeleton')).toBeInTheDocument()
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument()
  })
})

// ── Staff role gating ─────────────────────────────────────────────────────────

describe('RequireRole — staff role gating', () => {
  it('renders children when user.roleId matches the gate role', () => {
    withStaffUser('doctor')

    renderGuard(['doctor'])

    expect(screen.getByTestId('protected-content')).toBeInTheDocument()
  })

  it('redirects when user.roleId does not match the gate role', () => {
    withStaffUser('receptionist')

    renderGuard(['doctor'])

    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument()
    expect(screen.getByTestId('navigate-redirect')).toHaveAttribute('data-to', '/login')
  })

  it('prefers roleId over coarser role field for matching', () => {
    // user.role = 'user' (Better Auth coarse bucket), user.roleId = 'admin'
    withStaffUser('admin', 'user')

    renderGuard(['admin'])

    expect(screen.getByTestId('protected-content')).toBeInTheDocument()
  })

  it('falls back to user.role when roleId is null', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u-1', name: 'Staff', email: 'staff@framada.app', roleId: null, role: 'doctor' },
      loading: false,
    } as any)

    renderGuard(['doctor'])

    expect(screen.getByTestId('protected-content')).toBeInTheDocument()
  })

  it('redirects when no user is authenticated', () => {
    noStaff()

    renderGuard(['admin'])

    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument()
    expect(screen.getByTestId('navigate-redirect')).toHaveAttribute('data-to', '/login')
  })

  it('allows access when gate lists multiple roles and user matches one', () => {
    withStaffUser('lab_technician')

    renderGuard(['doctor', 'lab_technician', 'external_trainer'])

    expect(screen.getByTestId('protected-content')).toBeInTheDocument()
  })
})

// ── 'staff' meta-role ─────────────────────────────────────────────────────────

describe('RequireRole — "staff" meta-role', () => {
  it('allows admin through the "staff" meta-gate', () => {
    withStaffUser('admin')

    renderGuard(['staff'])

    expect(screen.getByTestId('protected-content')).toBeInTheDocument()
  })

  it('allows receptionist through the "staff" meta-gate', () => {
    withStaffUser('receptionist')

    renderGuard(['staff'])

    expect(screen.getByTestId('protected-content')).toBeInTheDocument()
  })

  it('allows nurse through the "staff" meta-gate', () => {
    withStaffUser('nurse')

    renderGuard(['staff'])

    expect(screen.getByTestId('protected-content')).toBeInTheDocument()
  })

  it('allows assistant through the "staff" meta-gate', () => {
    withStaffUser('assistant')

    renderGuard(['staff'])

    expect(screen.getByTestId('protected-content')).toBeInTheDocument()
  })

  it('does NOT allow doctor through the "staff" meta-gate (doctor has own gate)', () => {
    withStaffUser('doctor')

    renderGuard(['staff'])

    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument()
    expect(screen.getByTestId('navigate-redirect')).toHaveAttribute('data-to', '/login')
  })

  it('does NOT allow external_trainer through the "staff" meta-gate', () => {
    withStaffUser('external_trainer')

    renderGuard(['staff'])

    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument()
    expect(screen.getByTestId('navigate-redirect')).toHaveAttribute('data-to', '/login')
  })

  it('does NOT allow lab_technician through the "staff" meta-gate', () => {
    withStaffUser('lab_technician')

    renderGuard(['staff'])

    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument()
    expect(screen.getByTestId('navigate-redirect')).toHaveAttribute('data-to', '/login')
  })
})

// ── Redirect behaviour ────────────────────────────────────────────────────────

describe('RequireRole — redirect destination', () => {
  it('redirects to /login when no valid session matches', () => {
    noStaff()

    renderGuard(['admin'], { route: '/dashboard' })

    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument()
    expect(screen.getByTestId('navigate-redirect')).toHaveAttribute('data-to', '/login')
  })

  it('does not render protected content after redirect (wrong role)', () => {
    withStaffUser('receptionist')

    renderGuard(['admin'])

    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument()
    expect(screen.getByTestId('navigate-redirect')).toHaveAttribute('data-to', '/login')
  })
})
