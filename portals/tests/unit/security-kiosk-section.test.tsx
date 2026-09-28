/**
 * settings-domain-audit B5 (multi-key) + S5: this section saves two keys with
 * one button — `security:kiosk_config` (only `idleLockSeconds`, the field the
 * kiosk reads) and `security:audit_retention` (read by the monthly retention
 * job). If either failed to load, saving would write that key's defaults over
 * its stored value — so one failed key must block the whole save.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), put: vi.fn() },
}))
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

import { SecurityKioskSection } from '@/features/settings/components/security-kiosk-section'
import { api } from '@/lib/api-client'
import { renderWithRouter } from './_test-utils'

const mockApiGet = vi.mocked(api.get)
const mockApiPut = vi.mocked(api.put)

describe('SecurityKioskSection', () => {
  beforeEach(() => {
    mockApiPut.mockResolvedValue({ success: true })
  })
  afterEach(() => vi.clearAllMocks())

  it('saves exactly the kiosk idle timeout and the retention period', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: null })
    renderWithRouter(<SecurityKioskSection />)
    const save = screen.getByRole('button', { name: /save security policies/i })
    await waitFor(() => expect(save).not.toBeDisabled())

    fireEvent.click(save)
    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(2))
    const calls = [...mockApiPut.mock.calls].sort(([a], [b]) => String(a).localeCompare(String(b)))
    expect(calls).toEqual([
      ['/api/settings/kv/security:audit_retention', { value: { retentionPeriod: '1_year' } }],
      ['/api/settings/kv/security:kiosk_config', { value: { idleLockSeconds: 90 } }],
    ])
  })

  it('does not fetch the removed session-policy key', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: null })
    renderWithRouter(<SecurityKioskSection />)
    await waitFor(() => expect(mockApiGet).toHaveBeenCalledTimes(2))
    const paths = mockApiGet.mock.calls.map(([path]) => path)
    expect(paths).not.toContain('/api/settings/kv/security:session_policy')
  })

  it('blocks the save when one of the two keys failed to load', async () => {
    mockApiGet.mockImplementation(async (path: string) =>
      path.endsWith('security:audit_retention')
        ? { success: false, error: 'Network error' }
        : { success: true, data: null }
    )
    renderWithRouter(<SecurityKioskSection />)
    expect(await screen.findByText(/couldn.t load these settings/i)).toBeInTheDocument()

    const save = screen.getByRole('button', { name: /save security policies/i })
    expect(save).toBeDisabled()
    fireEvent.click(save)
    expect(mockApiPut).not.toHaveBeenCalled()
  })
})
