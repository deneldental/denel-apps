/**
 * Integrations → Hubtel: the test sends ONE real SMS to a number the admin
 * enters (Hubtel has no free credential check), and the card reports what
 * actually happened — sent, simulated in local development, or refused.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}))
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

import { HubtelConfigCard } from '@/features/integrations/components/hubtel-config-card'
import { api } from '@/lib/api-client'
import { renderWithRouter } from './_test-utils'

const mockApiGet = vi.mocked(api.get)
const mockApiPost = vi.mocked(api.post)

async function enterPhoneAndSend(phone: string) {
  const input = await screen.findByLabelText(/send a test sms to/i)
  fireEvent.change(input, { target: { value: phone } })
  fireEvent.click(screen.getByRole('button', { name: /send test sms/i }))
}

describe('HubtelConfigCard — test SMS', () => {
  beforeEach(() => {
    mockApiGet.mockResolvedValue({
      success: true,
      data: {
        senderId: 'Denel',
        hasClientId: true,
        hasClientSecret: true,
        clientIdMasked: '••••t-id',
        clientSecretMasked: '••••cret',
      },
    })
  })
  afterEach(() => vi.clearAllMocks())

  it('sends a test SMS to the number entered and confirms it went out', async () => {
    mockApiPost.mockResolvedValue({ success: true, data: { ok: true, sent: true } })
    renderWithRouter(<HubtelConfigCard />)

    await enterPhoneAndSend('0240000001')

    await waitFor(() =>
      expect(mockApiPost).toHaveBeenCalledWith('/api/integrations/hubtel/test', {
        phone: '0240000001',
      })
    )
    expect(await screen.findByText(/test sms sent/i)).toBeInTheDocument()
  })

  it('says plainly when local development only simulated the send', async () => {
    mockApiPost.mockResolvedValue({
      success: true,
      data: { ok: true, sent: false, simulated: true, reason: 'SMS_REDIRECT_PHONE is not set' },
    })
    renderWithRouter(<HubtelConfigCard />)

    await enterPhoneAndSend('0240000001')

    expect(await screen.findByText(/not sent/i)).toHaveTextContent('SMS_REDIRECT_PHONE is not set')
  })

  it('shows why Hubtel refused the message', async () => {
    mockApiPost.mockResolvedValue({
      success: true,
      data: { ok: false, error: 'Hubtel rejected the message: Invalid SenderId (From)' },
    })
    renderWithRouter(<HubtelConfigCard />)

    await enterPhoneAndSend('0240000001')

    expect(
      await screen.findByText(/Hubtel rejected the message: Invalid SenderId \(From\)/)
    ).toBeInTheDocument()
  })

  it('cannot send a test without a phone number', async () => {
    renderWithRouter(<HubtelConfigCard />)

    expect(await screen.findByRole('button', { name: /send test sms/i })).toBeDisabled()
    expect(mockApiPost).not.toHaveBeenCalled()
  })
})
