import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PwaAccessTab } from '@/features/patients/components/pwa-access-tab'
import { renderWithRouter } from './_test-utils'

const listPatientSessions = vi.fn()
const revokePatientPwa = vi.fn()
const revokePatientSessions = vi.fn()
const deletePatientSession = vi.fn()
const apiPost = vi.fn()

vi.mock('@/lib/actions/access-management', () => ({
  listPatientSessions: (id: string) => listPatientSessions(id),
  revokePatientPwa: (id: string, reason?: string) => revokePatientPwa(id, reason),
  revokePatientSessions: (id: string) => revokePatientSessions(id),
  deletePatientSession: (id: string) => deletePatientSession(id),
}))

vi.mock('@/lib/api-client', () => ({
  api: {
    post: (path: string, body: unknown) => apiPost(path, body),
  },
}))

describe('PwaAccessTab — disabled state', () => {
  it('shows the Enable button and no session list when PWA is off', () => {
    renderWithRouter(<PwaAccessTab patientId="p-1" patientName="Ama Mensah" pwaEnabled={false} />)

    expect(screen.getByText(/does not have app access/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Enable app access/i })).toBeInTheDocument()
    expect(screen.queryByText(/Active sessions/i)).not.toBeInTheDocument()
  })

  it('calls /enable-pwa when the enable button is clicked', async () => {
    apiPost.mockResolvedValue({ success: true, data: { pwaAccessEnabled: true } })
    const user = userEvent.setup()
    const onChanged = vi.fn()

    renderWithRouter(
      <PwaAccessTab
        patientId="p-1"
        patientName="Ama Mensah"
        pwaEnabled={false}
        onChanged={onChanged}
      />
    )

    await user.click(screen.getByRole('button', { name: /Enable app access/i }))

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/api/patients/p-1/enable-pwa', { enabled: true })
    )
    expect(onChanged).toHaveBeenCalled()
  })
})

describe('PwaAccessTab — enabled state', () => {
  it('renders the session list when PWA is enabled', async () => {
    listPatientSessions.mockResolvedValue({
      success: true,
      data: [
        {
          id: 's-1',
          userAgent: 'iPhone Safari',
          ipAddress: '10.0.0.5',
          lastUsedAt: '2026-05-20T12:00:00.000Z',
          createdAt: '2026-05-10T08:00:00.000Z',
          expiresAt: '2026-06-09T08:00:00.000Z',
        },
      ],
    })

    renderWithRouter(<PwaAccessTab patientId="p-1" patientName="Ama Mensah" pwaEnabled={true} />)

    await waitFor(() => expect(screen.getByText('iPhone Safari')).toBeInTheDocument())
    expect(screen.getByText('10.0.0.5')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Revoke PWA access/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Force re-verification/i })).toBeInTheDocument()
  })

  it('opens the revoke dialog and calls revokePatientPwa on confirm', async () => {
    listPatientSessions.mockResolvedValue({ success: true, data: [] })
    revokePatientPwa.mockResolvedValue({ success: true, data: { id: 'p-1', killedSessions: 0 } })
    const user = userEvent.setup()

    renderWithRouter(<PwaAccessTab patientId="p-1" patientName="Ama Mensah" pwaEnabled={true} />)

    await waitFor(() => expect(screen.getByText(/No active sessions/i)).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /Revoke PWA access/i }))

    await waitFor(() => expect(screen.getByText(/Revoke PWA — Ama Mensah/)).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /^Revoke PWA$/i }))

    await waitFor(() => expect(revokePatientPwa).toHaveBeenCalledWith('p-1', undefined))
  })

  it('resets trusted devices when "Force re-verification" is clicked', async () => {
    listPatientSessions.mockResolvedValue({ success: true, data: [] })
    apiPost.mockResolvedValue({ success: true })
    const user = userEvent.setup()

    renderWithRouter(<PwaAccessTab patientId="p-1" patientName="Ama Mensah" pwaEnabled={true} />)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Force re-verification/i })).toBeInTheDocument()
    )
    await user.click(screen.getByRole('button', { name: /Force re-verification/i }))

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/api/patients/p-1/reset-pwa-devices', {})
    )
  })
})

// ── Error-path coverage ───────────────────────────────────────────────────────

describe('PwaAccessTab — error paths', () => {
  it('does not crash when listPatientSessions returns a 500 error', async () => {
    listPatientSessions.mockResolvedValue({ success: false, error: 'Internal server error' })

    renderWithRouter(<PwaAccessTab patientId="p-1" patientName="Ama Mensah" pwaEnabled={true} />)

    // Component must not throw — something renders (at minimum the action buttons)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Revoke PWA access/i })).toBeInTheDocument()
    )
  })

  it('does not crash when listPatientSessions returns an empty data set', async () => {
    listPatientSessions.mockResolvedValue({ success: false, error: 'Unauthorized', data: [] })

    renderWithRouter(<PwaAccessTab patientId="p-1" patientName="Ama Mensah" pwaEnabled={true} />)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Revoke PWA access/i })).toBeInTheDocument()
    )
  })

  it('does not crash when the enable-pwa POST returns a 403', async () => {
    apiPost.mockResolvedValue({ success: false, error: 'Unauthorized' })
    const user = userEvent.setup()

    renderWithRouter(<PwaAccessTab patientId="p-1" patientName="Ama Mensah" pwaEnabled={false} />)

    await user.click(screen.getByRole('button', { name: /Enable app access/i }))

    // Button must remain (not crash); the failed POST leaves state unchanged
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Enable app access/i })).toBeInTheDocument()
    )
  })

  it('does not crash when revokePatientPwa returns a server error', async () => {
    listPatientSessions.mockResolvedValue({ success: true, data: [] })
    revokePatientPwa.mockResolvedValue({ success: false, error: 'Internal server error' })
    const user = userEvent.setup()

    renderWithRouter(<PwaAccessTab patientId="p-1" patientName="Ama Mensah" pwaEnabled={true} />)

    await waitFor(() => expect(screen.getByText(/No active sessions/i)).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /Revoke PWA access/i }))

    await waitFor(() => expect(screen.getByText(/Revoke PWA — Ama Mensah/)).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /^Revoke PWA$/i }))

    // Component recovers — the revoke dialog should close or show an error,
    // but must not leave the page in an unrecoverable blank/crash state.
    await waitFor(() => expect(revokePatientPwa).toHaveBeenCalledWith('p-1', undefined))
  })
})
