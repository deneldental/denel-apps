/**
 * VAPID configuration for web-push. Keys come from env; the subject (the
 * contact address push services use to reach the clinic) defaults to the Denel
 * clinic email, and is overridable via VAPID_SUBJECT.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const setVapidDetails = vi.hoisted(() => vi.fn())
vi.mock('web-push', () => ({ default: { setVapidDetails, sendNotification: vi.fn() } }))
vi.mock('../../src/db', () => ({ getDb: vi.fn(() => ({})) }))
vi.mock('../../src/lib/logger', () => ({ logError: vi.fn() }))

import { configureWebPush } from '../../src/lib/push'

beforeEach(() => {
  vi.resetModules()
  setVapidDetails.mockClear()
  vi.stubEnv('VAPID_PUBLIC_KEY', 'test-public-key')
  vi.stubEnv('VAPID_PRIVATE_KEY', 'test-private-key')
})
afterEach(() => vi.unstubAllEnvs())

describe('configureWebPush', () => {
  it('defaults the VAPID subject to the Denel clinic email', async () => {
    vi.stubEnv('VAPID_SUBJECT', undefined)
    const { configureWebPush: fresh } = await import('../../src/lib/push')

    expect(fresh()).toBe(true)
    expect(setVapidDetails).toHaveBeenCalledWith(
      'mailto:info@deneldental.com',
      'test-public-key',
      'test-private-key'
    )
  })

  it('is a no-op when the keypair is absent', () => {
    vi.stubEnv('VAPID_PUBLIC_KEY', undefined)

    expect(configureWebPush()).toBe(false)
  })
})
