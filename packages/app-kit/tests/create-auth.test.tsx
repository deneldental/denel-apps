/**
 * createAuth — the shared email + password auth glue (HR app).
 *
 * F20 / D8: a person whose password an administrator set must choose their own before
 * anything else. This pins the HR side of that — the session carries the flag,
 * `RequireAuth` sends a flagged person to the change-password route (and lets that one
 * route through, so it cannot loop), and `changePassword` replaces the password, ends
 * the other sessions, and clears the flag by re-reading the session.
 *
 * The backend's refusal of every other call is pinned in
 * backend/tests/integration/must-change-password.test.ts; this package has no way to
 * prove it from here and does not try.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const client = {
  getSession: vi.fn(),
  signIn: { email: vi.fn() },
  signOut: vi.fn(),
  changePassword: vi.fn(),
}
vi.mock('better-auth/react', () => ({ createAuthClient: () => client }))
vi.mock('better-auth/client/plugins', () => ({
  adminClient: () => ({}),
  inferAdditionalFields: () => ({}),
}))

import { createAuth } from '../src/auth/create-auth'
import { MIN_PASSWORD_LENGTH, validateNewPassword } from '../src/auth/password'

const user = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  name: 'Dr Ama',
  email: 'ama@clinic.test',
  roleId: 'hr_admin',
  ...over,
})

function makeAuth(config: { changePasswordPath?: string } = {}) {
  return createAuth({
    baseURL: 'http://api.test',
    appId: 'hr',
    cacheKey: `test_user_${Math.random()}`,
    ...config,
  })
}

/** Renders `route` with the auth tree: a guarded app, the change-password route, login. */
function mount(
  auth: ReturnType<typeof makeAuth>,
  route: string,
  changePath = '/auth/change-password'
) {
  const { AuthProvider, RequireAuth, useAuth } = auth
  function ChangeScreen() {
    const { user: me, changePassword } = useAuth()
    return (
      <div>
        <p>change-password screen</p>
        <p data-testid="flag">{String(me?.mustChangePassword)}</p>
        <button type="button" onClick={() => void changePassword('given', 'chosen-by-me-alone')}>
          submit
        </button>
      </div>
    )
  }
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>
        <Routes>
          <Route
            path="/dashboard"
            element={
              <RequireAuth>
                <p>dashboard</p>
              </RequireAuth>
            }
          />
          <Route
            path={changePath}
            element={
              <RequireAuth>
                <ChangeScreen />
              </RequireAuth>
            }
          />
          <Route path="/auth/login" element={<p>login screen</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
})

describe('RequireAuth', () => {
  it('sends a person whose password an administrator set to the change-password route', async () => {
    client.getSession.mockResolvedValue({ data: { user: user({ mustChangePassword: true }) } })
    mount(makeAuth(), '/dashboard')

    expect(await screen.findByText('change-password screen')).toBeInTheDocument()
    expect(screen.queryByText('dashboard')).not.toBeInTheDocument()
  })

  it('lets that one route through for a flagged person, so it cannot loop', async () => {
    client.getSession.mockResolvedValue({ data: { user: user({ mustChangePassword: true }) } })
    mount(makeAuth(), '/auth/change-password')

    expect(await screen.findByText('change-password screen')).toBeInTheDocument()
    expect(screen.getByTestId('flag')).toHaveTextContent('true')
  })

  it('lets an unflagged person through', async () => {
    client.getSession.mockResolvedValue({ data: { user: user({ mustChangePassword: false }) } })
    mount(makeAuth(), '/dashboard')

    expect(await screen.findByText('dashboard')).toBeInTheDocument()
  })

  it('still sends a signed-out visitor to sign-in', async () => {
    client.getSession.mockResolvedValue({ data: null })
    mount(makeAuth(), '/dashboard')

    expect(await screen.findByText('login screen')).toBeInTheDocument()
  })

  it('honours a different change-password path', async () => {
    client.getSession.mockResolvedValue({ data: { user: user({ mustChangePassword: true }) } })
    mount(makeAuth({ changePasswordPath: '/account/password' }), '/dashboard', '/account/password')

    expect(await screen.findByText('change-password screen')).toBeInTheDocument()
  })
})

describe('changePassword', () => {
  it('replaces the password, ends other sessions, and clears the flag by re-reading the session', async () => {
    client.getSession
      .mockResolvedValueOnce({ data: { user: user({ mustChangePassword: true }) } })
      .mockResolvedValue({ data: { user: user({ mustChangePassword: false }) } })
    client.changePassword.mockResolvedValue({ data: {}, error: null })
    mount(makeAuth(), '/auth/change-password')

    expect(await screen.findByTestId('flag')).toHaveTextContent('true')
    screen.getByRole('button', { name: 'submit' }).click()

    await waitFor(() => expect(screen.getByTestId('flag')).toHaveTextContent('false'))
    expect(client.changePassword).toHaveBeenCalledWith({
      currentPassword: 'given',
      newPassword: 'chosen-by-me-alone',
      revokeOtherSessions: true,
    })
  })

  it('reports a wrong current password without refreshing the session', async () => {
    client.getSession.mockResolvedValue({ data: { user: user({ mustChangePassword: true }) } })
    client.changePassword.mockResolvedValue({
      data: null,
      error: { status: 400, code: 'INVALID_PASSWORD', message: 'Invalid password' },
    })
    const auth = makeAuth()
    let result: { success: boolean; error?: string } | undefined
    function Probe() {
      const { changePassword, user: me } = auth.useAuth()
      return (
        <button
          type="button"
          disabled={!me}
          onClick={async () => {
            result = await changePassword('wrong', 'chosen-by-me-alone')
          }}
        >
          go
        </button>
      )
    }
    render(
      <MemoryRouter>
        <auth.AuthProvider>
          <Probe />
        </auth.AuthProvider>
      </MemoryRouter>
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'go' })).toBeEnabled())
    const calls = client.getSession.mock.calls.length
    screen.getByRole('button', { name: 'go' }).click()

    await waitFor(() => expect(result).toBeDefined())
    expect(result).toEqual({ success: false, error: 'The password you were given is not correct.' })
    expect(client.getSession.mock.calls.length).toBe(calls)
  })
})

describe('validateNewPassword', () => {
  const GIVEN = 'Given-By-The-Admin-1'
  const CHOSEN = 'Chosen-By-Me-Alone-2'

  it('accepts a different, long-enough, confirmed password', () => {
    expect(validateNewPassword(GIVEN, CHOSEN, CHOSEN)).toBeNull()
  })

  it.each([
    ['no current password', '', CHOSEN, CHOSEN, /password you were given/i],
    [
      'one under the minimum',
      GIVEN,
      'x'.repeat(MIN_PASSWORD_LENGTH - 1),
      'x'.repeat(MIN_PASSWORD_LENGTH - 1),
      /at least/i,
    ],
    ['the same password again', GIVEN, GIVEN, GIVEN, /different/i],
    ['a confirmation that differs', GIVEN, CHOSEN, `${CHOSEN}!`, /do not match/i],
  ])('refuses %s', (_label, current, next, confirm, message) => {
    expect(validateNewPassword(current, next, confirm)).toMatch(message)
  })
})
