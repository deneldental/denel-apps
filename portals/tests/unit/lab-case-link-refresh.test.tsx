/**
 * Labs → a case → "Update progress". The case comes back with the patient's
 * photo, whose private link is re-signed every 15 minutes; a refetch after a
 * quarter-hour boundary must not wipe the notes or stage being entered.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))
vi.mock('@/lib/permissions-context', () => ({ useCan: () => true }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import LabCaseDetailPage from '@/features/labs/pages/case-detail'
import { api } from '@/lib/api-client'

beforeAll(() => {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>
  proto.hasPointerCapture ??= () => false
  proto.setPointerCapture ??= () => {}
  proto.releasePointerCapture ??= () => {}
  proto.scrollIntoView ??= () => {}
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
afterEach(() => vi.clearAllMocks())

const photo = (window: string) =>
  `https://denel-private.acct.r2.cloudflarestorage.com/avatars/ama.jpg?X-Amz-Date=20260927T${window}00Z&X-Amz-Signature=${window}`

function labCase(profileImage: string) {
  return {
    id: 'c-1',
    status: 'sent',
    notes: 'Shade A2',
    delayReason: null,
    expectedReturn: null,
    patientId: 'p-1',
    patient: { id: 'p-1', name: 'Ama Mensah', profileImage },
    vendor: null,
    photos: [],
  }
}

function serve(profileImage: string) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path === '/api/labs/cases/c-1') return { success: true, data: labCase(profileImage) }
    if (path.includes('/status-history')) return { success: true, data: [], total: 0 } as never
    return { success: true, data: [] }
  })
}

describe('Lab case "Update progress"', () => {
  it('keeps the notes being typed when a refetch brings the case back with a fresh photo link', async () => {
    const user = userEvent.setup()
    serve(photo('1000'))
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/labs/cases/c-1']}>
          <Routes>
            <Route path="/labs/cases/:id" element={<LabCaseDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
    const notes = await screen.findByPlaceholderText(/add internal notes/i)
    await waitFor(() => expect(notes).toHaveValue('Shade A2'))
    await user.clear(notes)
    await user.type(notes, 'Shade A3, rush')

    serve(photo('1015'))
    await queryClient.refetchQueries({ queryKey: ['labs'] })
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(3))
    await new Promise((r) => setTimeout(r, 50))

    expect(screen.getByPlaceholderText(/add internal notes/i)).toHaveValue('Shade A3, rush')
  })
})
