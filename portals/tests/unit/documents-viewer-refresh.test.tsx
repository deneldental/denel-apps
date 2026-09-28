/**
 * Patient → Documents → a document's viewer. The viewer used to keep the copy
 * of the document it was opened with, so after an hour its Download button
 * opened an expired link even though the list behind it had fresh ones. It now
 * reads the current copy — while its preview keeps its first link, so an open
 * PDF does not reload back to page 1 on every refresh.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))
vi.mock('@/features/clinical/use-clinical-preferences', () => ({
  useToothNotation: () => ({ toothLabel: (t: unknown) => String(t ?? '') }),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { DocumentsTab } from '@/features/patient-media/components/documents-tab'
import { api } from '@/lib/api-client'

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

const link = (window: string) =>
  `https://denel-private.acct.r2.cloudflarestorage.com/patients/p-1/docs/referral.pdf?X-Amz-Date=20260927T${window}00Z&X-Amz-Signature=${window}`

function serve(fileUrl: string) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path === '/api/patient-media/documents/patient/p-1') {
      return {
        success: true,
        data: [
          {
            id: 'd-1',
            patientId: 'p-1',
            category: 'other',
            clinicalScope: false,
            fileName: 'referral.pdf',
            fileUrl,
            fileSize: 1000,
            mimeType: 'application/pdf',
            notes: 'Referral letter',
            uploadedById: null,
            uploadedAt: '2026-09-27T09:00:00Z',
          },
        ],
      }
    }
    return { success: true, data: [] }
  })
}

describe('Document viewer after a refresh', () => {
  it('downloads with the current link while the preview keeps its first one', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    serve(link('1000'))
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <DocumentsTab patientId="p-1" />
        </MemoryRouter>
      </QueryClientProvider>
    )
    fireEvent.click(await screen.findByText('Referral letter'))
    const preview = await screen.findByTitle('Referral letter')
    expect(preview.getAttribute('src')).toBe(link('1000'))

    serve(link('1100'))
    await queryClient.refetchQueries()
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(3))
    await new Promise((r) => setTimeout(r, 20))

    fireEvent.click(screen.getByRole('button', { name: /download/i }))
    expect(open).toHaveBeenCalledWith(link('1100'), '_blank', 'noopener,noreferrer')
    expect(screen.getByTitle('Referral letter').getAttribute('src')).toBe(link('1000'))
  })
})
