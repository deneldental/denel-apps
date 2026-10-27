/**
 * G08 — what the two payment actions send when the patient is to be texted a payment confirmation.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (G08) and step-10-handover.md.
 *
 * The server texts only when the body says `sendSms: true`, and works the amount out itself. So the
 * actions send the flag when asked, send nothing about a text otherwise, and never send an amount for it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-client', () => ({ api: { get: vi.fn(), post: vi.fn() } }))

import { postDraftPayment } from '@/lib/actions/payments-v2'
import { confirmEstimate } from '@/lib/actions/worklist'
import { api } from '@/lib/api-client'

const post = vi.mocked(api.post)

afterEach(() => vi.resetAllMocks())

describe('postDraftPayment', () => {
  it('asks for the text when told to', async () => {
    post.mockResolvedValue({ success: true })

    await postDraftPayment('pay-1', { sendSms: true })

    expect(post).toHaveBeenCalledWith(
      '/api/payments/pay-1/post',
      { sendSms: true },
      expect.anything()
    )
  })

  it('says nothing about a text otherwise', async () => {
    post.mockResolvedValue({ success: true })

    await postDraftPayment('pay-1', { sendSms: false })
    await postDraftPayment('pay-2')

    expect(post.mock.calls.map((c) => c[1])).toEqual([{}, {}])
  })
})

describe('confirmEstimate', () => {
  const payments = [{ method: 'cash', amount: 10000, externalReference: null }]

  it('asks for the text when told to, with the payments', async () => {
    post.mockResolvedValue({ success: true })

    await confirmEstimate('appt-1', payments, { sendSms: true })

    expect(post).toHaveBeenCalledWith('/api/worklist/appt-1/confirm', {
      payments,
      sendSms: true,
    })
  })

  it('says nothing about a text otherwise', async () => {
    post.mockResolvedValue({ success: true })

    await confirmEstimate('appt-1', payments, { sendSms: false })
    await confirmEstimate('appt-1', payments)

    expect(post.mock.calls.map((c) => c[1])).toEqual([{ payments }, { payments }])
  })

  // Review §8.16, F88: the lines reception ticked reach the server, which issues only those.
  it('sends the lines reception ticked, when it is given them', async () => {
    post.mockResolvedValue({ success: true })

    await confirmEstimate('appt-1', payments, { acceptedLineItemIds: ['l1'] })

    expect(post).toHaveBeenCalledWith('/api/worklist/appt-1/confirm', {
      payments,
      acceptedLineItemIds: ['l1'],
    })
  })
})
