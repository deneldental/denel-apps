/**
 * F29 — CRM → Holidays "SMS history" shows who each message went to and what it said.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md.
 *
 * The table read `recipientPhone`, `recipientName` and `message`, but
 * `GET /api/sms/messages` returns `recipient`, `patient.name` and `content` (the
 * `sms_messages` columns), so every row showed a dash, an empty phone and an empty
 * message.
 */
import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import HolidaysPage from '@/features/crm/pages/holidays'
import { api } from '@/lib/api-client'

afterEach(() => vi.resetAllMocks())

// The shape the endpoint really returns (sms_messages + the joined patient name).
const MESSAGES = [
  {
    id: 'm1',
    recipient: '0240000001',
    content: 'Happy holidays from Denel Dental, Ama!',
    type: 'bulk',
    status: 'sent',
    patient: { id: 'p1', name: 'Ama Mensah' },
    sentAt: '2026-12-24T09:00:00.000Z',
    createdAt: '2026-12-24T09:00:00.000Z',
  },
  {
    id: 'm2',
    recipient: '0240000002',
    content: 'Season’s greetings!',
    type: 'bulk',
    status: 'failed',
    patient: null,
    sentAt: '2026-12-24T09:01:00.000Z',
    createdAt: '2026-12-24T09:01:00.000Z',
  },
]

function renderPage() {
  vi.mocked(api.get).mockImplementation((async (url: string) => {
    if (url.startsWith('/api/sms/messages')) return { success: true, data: MESSAGES }
    if (url.startsWith('/api/reminder-templates')) return { success: true, data: [] }
    return { success: false, error: `unexpected GET ${url}` }
  }) as never)
  render(<HolidaysPage />)
}

describe('CRM → Holidays SMS history', () => {
  it('shows the patient, the number and the message the API returns', async () => {
    renderPage()
    const row = (await screen.findByText('Ama Mensah')).closest('tr') as HTMLElement
    expect(within(row).getByText('0240000001')).toBeInTheDocument()
    expect(within(row).getByText('Happy holidays from Denel Dental, Ama!')).toBeInTheDocument()
  })

  it('shows the number and message for a message with no linked patient', async () => {
    renderPage()
    const row = (await screen.findByText('0240000002')).closest('tr') as HTMLElement
    expect(within(row).getByText('—')).toBeInTheDocument()
    expect(within(row).getByText('Season’s greetings!')).toBeInTheDocument()
  })
})
