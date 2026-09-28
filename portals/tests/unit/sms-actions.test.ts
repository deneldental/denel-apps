/**
 * An SMS sent without a sender must leave the choice to the server, which uses
 * the Sender ID configured in Integrations. The action used to default it to
 * the clinic's full name — not an approved Hubtel Sender ID (max 11 chars) — so
 * Hubtel would refuse every message sent from the CRM composer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}))

import { sendSMS } from '@/lib/actions/sms'
import { api } from '@/lib/api-client'

const mockApiPost = vi.mocked(api.post)
const recipients = [{ phone: '0240000001', message: 'Hello' }]

describe('sendSMS action', () => {
  afterEach(() => vi.clearAllMocks())

  it('leaves the sender to the server when the caller names none', async () => {
    mockApiPost.mockResolvedValue({ success: true })

    await sendSMS(recipients, undefined, 'bulk')

    expect(mockApiPost).toHaveBeenCalledTimes(1)
    const [path, body] = mockApiPost.mock.calls[0]
    expect(path).toBe('/api/sms/send')
    expect((body as { from?: string }).from).toBeUndefined()
  })

  it('passes on the sender an admin chose', async () => {
    mockApiPost.mockResolvedValue({ success: true })

    await sendSMS(recipients, 'Denel', 'birthday')

    expect(mockApiPost).toHaveBeenCalledWith('/api/sms/send', {
      recipients,
      from: 'Denel',
      type: 'birthday',
    })
  })
})
