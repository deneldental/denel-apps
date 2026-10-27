/**
 * F20 / D8 — the portal sends a person whose password an administrator set to the
 * change-password screen, and that screen really changes it.
 *
 * Pins the four places the portal takes part:
 *   - the sign-in hand-off (login action) sends a flagged person to the screen;
 *   - the dashboard guard sends a flagged SESSION there, before it loads anything else;
 *   - the screen refuses what the server would refuse, and posts the change with
 *     `revokeOtherSessions`;
 *   - a failure stays on screen with what the person typed.
 *
 * The backend's own refusal of every other call is pinned in
 * backend/tests/integration/must-change-password.test.ts.
 */
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithRouter } from './_test-utils'

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    getSession: vi.fn(),
    changePassword: vi.fn(),
    signOut: vi.fn(),
    signIn: { email: vi.fn() },
  },
}))
vi.mock('@/features/auth/portal-access', () => ({
  checkPortalAccess: vi.fn(),
  NO_PORTAL_ACCESS_MESSAGE: 'No portal access.',
}))
vi.mock('@/features/dashboard/components/dashboard-shell', () => ({
  DashboardShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="shell">{children}</div>
  ),
}))
vi.mock('@/features/appointments/components/appointment-alert-monitor', () => ({
  AppointmentAlertMonitor: () => null,
}))
vi.mock('@/lib/loading-context', () => ({
  useLoading: () => ({ isLoading: false, startLoading: vi.fn(), stopLoading: vi.fn() }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import DashboardLayout from '@/features/auth/guards/DashboardLayout'
import { changePassword } from '@/features/auth/pages/change-password/actions'
import ChangePasswordPage from '@/features/auth/pages/change-password/index'
import { login } from '@/features/auth/pages/login/actions'
import { checkPortalAccess } from '@/features/auth/portal-access'
import { authClient } from '@/lib/auth-client'

const getSession = vi.mocked(authClient.getSession)
const change = vi.mocked(authClient.changePassword)
const signOut = vi.mocked(authClient.signOut)
const signIn = vi.mocked(authClient.signIn.email)
const access = vi.mocked(checkPortalAccess)

const GIVEN = 'Given-By-The-Admin-1'
const CHOSEN = 'Chosen-By-Me-Alone-2'

beforeEach(() => {
  vi.resetAllMocks()
  signOut.mockResolvedValue(undefined as never)
})

describe('changePassword action — what is refused before anything is sent', () => {
  it.each([
    ['no current password', '', CHOSEN, CHOSEN, /password you were given/i],
    ['a new password under 12 characters', GIVEN, 'Short-1', 'Short-1', /at least 12/i],
    ['the same password again', GIVEN, GIVEN, GIVEN, /different/i],
    ['two new passwords that differ', GIVEN, CHOSEN, `${CHOSEN}x`, /do not match/i],
  ])('refuses %s', async (_label, current, next, confirm, message) => {
    const res = await changePassword(current, next, confirm)
    expect(res.success).toBe(false)
    expect(res.error).toMatch(message)
    expect(change).not.toHaveBeenCalled()
  })

  it('sends the change with revokeOtherSessions, so the old password stops working everywhere', async () => {
    change.mockResolvedValue({ data: {}, error: null } as never)
    const res = await changePassword(GIVEN, CHOSEN, CHOSEN)
    expect(res).toEqual({ success: true })
    expect(change).toHaveBeenCalledWith({
      currentPassword: GIVEN,
      newPassword: CHOSEN,
      revokeOtherSessions: true,
    })
  })

  it.each([
    [{ status: 400, code: 'INVALID_PASSWORD', message: 'Invalid password' }, /not correct/i],
    [{ status: 429, message: 'slow down' }, /too many attempts/i],
    [{ status: 0, message: 'fetch failed' }, /network error/i],
    [{ status: 400, message: 'Password too short' }, /too short/i],
  ])('explains a server refusal (%j)', async (error, message) => {
    change.mockResolvedValue({ data: null, error } as never)
    const res = await changePassword(GIVEN, CHOSEN, CHOSEN)
    expect(res.success).toBe(false)
    expect(res.error).toMatch(message)
  })
})

describe('login — the hand-off after a correct password', () => {
  it('sends a flagged person to the change-password screen', async () => {
    signIn.mockResolvedValue({
      data: { user: { id: 'u1', mustChangePassword: true } },
      error: null,
    } as never)
    access.mockResolvedValue('granted' as never)

    const res = await login('dr@clinic.test', GIVEN)
    expect(res).toEqual({ redirectPath: '/auth/change-password' })
  })

  it('sends everyone else to the dashboard', async () => {
    signIn.mockResolvedValue({
      data: { user: { id: 'u1', mustChangePassword: false } },
      error: null,
    } as never)
    access.mockResolvedValue('granted' as never)

    expect(await login('dr@clinic.test', GIVEN)).toEqual({ redirectPath: '/dashboard' })
  })

  it('still refuses a flagged person who has no portal access, and leaves no session behind', async () => {
    signIn.mockResolvedValue({
      data: { user: { id: 'u1', mustChangePassword: true } },
      error: null,
    } as never)
    access.mockResolvedValue('denied' as never)

    const res = await login('dr@clinic.test', GIVEN)
    expect(res.error).toBeTruthy()
    expect(res.redirectPath).toBeUndefined()
    expect(signOut).toHaveBeenCalled()
  })
})

describe('DashboardLayout — the guard', () => {
  const tree = (
    <Routes>
      <Route
        path="/dashboard"
        element={
          <DashboardLayout>
            <div>dashboard content</div>
          </DashboardLayout>
        }
      />
      <Route path="/auth/change-password" element={<div>change-password screen</div>} />
      <Route path="/auth/login" element={<div>login screen</div>} />
    </Routes>
  )

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            isAdmin: true,
            scopes: ['portal'],
            accessibleModules: [],
            permissions: {},
            menuItems: [],
          },
        }),
      }))
    )
  })

  it('sends a flagged session to the change-password screen before loading anything else', async () => {
    getSession.mockResolvedValue({
      data: { user: { id: 'u1', name: 'Dr', mustChangePassword: true } },
      error: null,
    } as never)

    renderWithRouter(tree, { initialRoute: '/dashboard' })

    expect(await screen.findByText('change-password screen')).toBeInTheDocument()
    expect(screen.queryByText('dashboard content')).not.toBeInTheDocument()
    // Not even the permissions call: the backend would refuse it, and the shell must not mount.
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('lets an unflagged session through to the dashboard', async () => {
    getSession.mockResolvedValue({
      data: { user: { id: 'u1', name: 'Dr', mustChangePassword: false } },
      error: null,
    } as never)

    renderWithRouter(tree, { initialRoute: '/dashboard' })

    expect(await screen.findByText('dashboard content')).toBeInTheDocument()
    expect(screen.queryByText('change-password screen')).not.toBeInTheDocument()
  })
})

describe('the change-password screen', () => {
  const tree = (
    <Routes>
      <Route path="/auth/change-password" element={<ChangePasswordPage />} />
      <Route path="/dashboard" element={<div>dashboard</div>} />
      <Route path="/auth/login" element={<div>login screen</div>} />
    </Routes>
  )
  const render = () => renderWithRouter(tree, { initialRoute: '/auth/change-password' })

  async function fill(user: ReturnType<typeof userEvent.setup>, confirm = CHOSEN) {
    await user.type(await screen.findByLabelText('Password you were given'), GIVEN)
    await user.type(screen.getByLabelText('New password'), CHOSEN)
    await user.type(screen.getByLabelText('Confirm new password'), confirm)
  }

  it('goes to sign-in when there is no session', async () => {
    getSession.mockResolvedValue({ data: null, error: null } as never)
    render()
    expect(await screen.findByText('login screen')).toBeInTheDocument()
  })

  it('changes the password and carries on to the dashboard', async () => {
    getSession.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null } as never)
    change.mockResolvedValue({ data: {}, error: null } as never)
    const user = userEvent.setup()
    render()

    await fill(user)
    await user.click(screen.getByRole('button', { name: /update password/i }))

    expect(await screen.findByText('dashboard')).toBeInTheDocument()
    expect(change).toHaveBeenCalledWith({
      currentPassword: GIVEN,
      newPassword: CHOSEN,
      revokeOtherSessions: true,
    })
  })

  it('keeps the person on the screen, with the reason, when the server refuses', async () => {
    getSession.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null } as never)
    change.mockResolvedValue({
      data: null,
      error: { status: 400, code: 'INVALID_PASSWORD', message: 'Invalid password' },
    } as never)
    const user = userEvent.setup()
    render()

    await fill(user)
    await user.click(screen.getByRole('button', { name: /update password/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/not correct/i)
    expect(screen.queryByText('dashboard')).not.toBeInTheDocument()
    // What they typed is still there to fix.
    expect(screen.getByLabelText('New password')).toHaveValue(CHOSEN)
  })

  it('can be left: sign out returns to sign-in', async () => {
    getSession.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null } as never)
    const user = userEvent.setup()
    render()

    await user.click(await screen.findByRole('button', { name: /sign out/i }))

    await waitFor(() => expect(signOut).toHaveBeenCalled())
    expect(await screen.findByText('login screen')).toBeInTheDocument()
  })
})
