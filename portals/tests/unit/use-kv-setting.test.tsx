/**
 * settings-domain-audit B5 / S6.3: `useKvSetting` is the one way a settings
 * section reads and writes a `clinic_settings` key. It must
 *   - load through TanStack under `queryKeys.settings.kv(key)` (so every
 *     reader of the key refreshes after a save — D3),
 *   - seed an editable value from the stored one merged over the defaults,
 *   - report a failed load and refuse to save until it succeeds (B5),
 *   - PUT `{ value }` on save and then re-read.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), put: vi.fn() },
}))

import { api } from '@/lib/api-client'
import { useKvSetting } from '@/shared/hooks/use-kv-setting'

const mockApiGet = vi.mocked(api.get)
const mockApiPut = vi.mocked(api.put)

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

type Policy = { a: number; b: string }
const DEFAULTS: Policy = { a: 1, b: 'x' }

describe('useKvSetting', () => {
  beforeEach(() => {
    mockApiPut.mockResolvedValue({ success: true })
  })
  afterEach(() => vi.clearAllMocks())

  it('seeds the value from the stored object merged over the defaults', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: { a: 5 } })
    const { result } = renderHook(() => useKvSetting<Policy>('scheduling:policies', DEFAULTS), {
      wrapper,
    })
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.value).toEqual({ a: 5, b: 'x' })
    expect(result.current.loaded).toEqual({ a: 5, b: 'x' })
    expect(result.current.canSave).toBe(true)
    expect(result.current.isDirty).toBe(false)
    expect(mockApiGet).toHaveBeenCalledWith('/api/settings/kv/scheduling:policies')
  })

  it('uses the defaults when the key has never been saved (null row)', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: null })
    const { result } = renderHook(() => useKvSetting<Policy>('scheduling:policies', DEFAULTS), {
      wrapper,
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.value).toEqual(DEFAULTS)
    expect(result.current.canSave).toBe(true)
  })

  it('returns a non-object stored value as-is', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: '24' })
    const { result } = renderHook(
      () => useKvSetting<string>('reminder_payment_cooldown_hours', '12'),
      { wrapper }
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.value).toBe('24')
  })

  it('applies a custom fromStored', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: 24 })
    const { result } = renderHook(
      () =>
        useKvSetting<string>('reminder_payment_cooldown_hours', '12', {
          fromStored: (stored) => String(stored),
        }),
      { wrapper }
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.value).toBe('24')
  })

  it('reports a failed load and refuses to save', async () => {
    mockApiGet.mockResolvedValue({ success: false, error: 'Network error' })
    const { result } = renderHook(() => useKvSetting<Policy>('scheduling:policies', DEFAULTS), {
      wrapper,
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.loadError).toBe('Network error')
    expect(result.current.canSave).toBe(false)
    // The draft still holds the defaults so the form can render — but a save
    // must be refused, or those defaults would overwrite the real config.
    await expect(result.current.save()).rejects.toThrow(/not loaded/i)
    expect(mockApiPut).not.toHaveBeenCalled()
  })

  it('tracks edits and PUTs the value, then re-reads', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: { a: 5, b: 'x' } })
    const { result } = renderHook(() => useKvSetting<Policy>('scheduling:policies', DEFAULTS), {
      wrapper,
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.setValue((v) => ({ ...v, a: 9 })))
    expect(result.current.isDirty).toBe(true)

    mockApiGet.mockResolvedValue({ success: true, data: { a: 9, b: 'x' } })
    await act(async () => {
      await result.current.save()
    })
    expect(mockApiPut).toHaveBeenCalledWith('/api/settings/kv/scheduling:policies', {
      value: { a: 9, b: 'x' },
    })
    await waitFor(() => expect(result.current.loaded).toEqual({ a: 9, b: 'x' }))
    expect(result.current.isDirty).toBe(false)
  })

  it('surfaces a failed save as a rejection', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: null })
    mockApiPut.mockResolvedValue({ success: false, error: 'Unauthorized' })
    const { result } = renderHook(() => useKvSetting<Policy>('scheduling:policies', DEFAULTS), {
      wrapper,
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await expect(result.current.save()).rejects.toThrow('Unauthorized')
  })
})
