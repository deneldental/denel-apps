/**
 * Integrations → R2: a private bucket next to the public one, and a Test that
 * reports each bucket. DigitalOcean Spaces keeps one bucket (per-object ACLs).
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { DoSpacesConfigCard } from '@/features/integrations/components/do-spaces-config-card'
import { R2ConfigCard } from '@/features/integrations/components/r2-config-card'
import { api } from '@/lib/api-client'
import { renderWithRouter } from './_test-utils'

const mockGet = vi.mocked(api.get)
const mockPost = vi.mocked(api.post)
const mockPut = vi.mocked(api.put)

const STATUS = {
  endpoint: 'https://0123456789abcdef.r2.cloudflarestorage.com',
  bucket: 'denel-dev-public',
  privateBucket: 'denel-dev-private',
  region: 'auto',
  publicUrl: 'https://pub-test.r2.dev',
  quotaGB: null,
  hasAccessKey: true,
  hasSecretKey: true,
  accessKeyMasked: '••••MPLE',
  secretKeyMasked: '••••MPLE',
}

beforeEach(() => {
  mockGet.mockImplementation(async (path: string) =>
    path.endsWith('/usage')
      ? { success: true, data: { usedBytes: 0, quotaBytes: null, objectCount: 0, partial: false } }
      : { success: true, data: STATUS }
  )
  mockPut.mockResolvedValue({ success: true })
})
afterEach(() => vi.clearAllMocks())

describe('R2 settings card', () => {
  it('shows the public and private buckets', async () => {
    renderWithRouter(<R2ConfigCard />)

    await waitFor(() =>
      expect(screen.getByLabelText('Public bucket')).toHaveValue('denel-dev-public')
    )
    expect(screen.getByLabelText('Private bucket')).toHaveValue('denel-dev-private')
  })

  it('saves the private bucket', async () => {
    renderWithRouter(<R2ConfigCard />)
    await waitFor(() =>
      expect(screen.getByLabelText('Private bucket')).toHaveValue('denel-dev-private')
    )
    fireEvent.change(screen.getByLabelText('Private bucket'), {
      target: { value: 'denel-dev-vault' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockPut).toHaveBeenCalled())
    expect(mockPut.mock.calls[0][1]).toMatchObject({ privateBucket: 'denel-dev-vault' })
  })

  it('reports each bucket after a test', async () => {
    mockPost.mockResolvedValue({
      success: true,
      data: {
        ok: false,
        error: 'denel-dev-private: AccessDenied',
        buckets: [
          { role: 'public', bucket: 'denel-dev-public', ok: true },
          { role: 'private', bucket: 'denel-dev-private', ok: false, error: 'AccessDenied' },
        ],
      },
    })
    renderWithRouter(<R2ConfigCard />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Test connection' })).toBeEnabled()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))

    expect(await screen.findByText('✓ Public bucket denel-dev-public')).toBeInTheDocument()
    expect(
      screen.getByText('✗ Private bucket denel-dev-private — AccessDenied')
    ).toBeInTheDocument()
  })

  it('has no private bucket field for DigitalOcean Spaces', async () => {
    renderWithRouter(<DoSpacesConfigCard />)

    expect(await screen.findByLabelText('Bucket')).toBeInTheDocument()
    expect(screen.queryByLabelText('Private bucket')).not.toBeInTheDocument()
  })
})
