/**
 * The Team PWA must fetch the VAPID public key from the backend at runtime
 * (GET /api/push/vapid-public-key), like the patient app — not bake it in from
 * import.meta.env.VITE_VAPID_PUBLIC_KEY at build time. Build-time keys can't
 * rotate without a rebuild and fail silently until a user taps "enable".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }))

import { api } from '@/lib/api'
import { subscribeToPush } from '@/shared/lib/push-notifications'

beforeEach(() => {
  // Make the push feature-detection pass so subscribeToPush reaches the fetch.
  vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn() })
  Object.defineProperty(globalThis, 'PushManager', { value: class {}, configurable: true })
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { getRegistration: vi.fn(), register: vi.fn(), ready: Promise.resolve({}) },
    configurable: true,
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('Team push VAPID key', () => {
  it('fetches the VAPID key from the backend endpoint', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: false } as never)

    await subscribeToPush().catch(() => {})

    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/api/push/vapid-public-key',
      expect.objectContaining({ suppressSessionExpiredHook: true })
    )
  })

  it('reports push as unconfigured (not a missing build var) when the backend has no key', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: false } as never)

    await expect(subscribeToPush()).rejects.toThrow('Push notifications are not configured')
  })
})
