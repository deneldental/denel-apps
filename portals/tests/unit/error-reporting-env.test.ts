/**
 * Sentry tags each event with the environment it came from. It must be the
 * DEPLOY environment (VITE_APP_ENV: development / staging / production), not
 * Vite's build MODE — MODE is always 'production' for any production build, so
 * staging errors were being filed under 'production' in Sentry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  init: vi.fn(),
}))

vi.mock('@/config/env', () => ({ env: new Proxy({}, { get: (_t, k: string) => state.env[k] }) }))
vi.mock('@sentry/react', () => ({ init: state.init, captureException: vi.fn() }))

beforeEach(() => {
  vi.resetModules()
  state.init.mockClear()
  state.env = {
    VITE_SENTRY_DSN: 'https://examplePublicKey@o0.ingest.sentry.io/0',
    VITE_APP_ENV: 'staging',
    MODE: 'production',
  }
})
afterEach(() => vi.clearAllMocks())

describe('portal error reporting', () => {
  it('tags Sentry with the deploy environment, not the build mode', async () => {
    const { initErrorReporting } = await import('@/shared/lib/error-reporting')

    await initErrorReporting()

    expect(state.init).toHaveBeenCalledTimes(1)
    expect(state.init.mock.calls[0][0]).toMatchObject({ environment: 'staging' })
  })

  it('does not initialise Sentry when no DSN is set', async () => {
    state.env.VITE_SENTRY_DSN = undefined
    const { initErrorReporting } = await import('@/shared/lib/error-reporting')

    await initErrorReporting()

    expect(state.init).not.toHaveBeenCalled()
  })
})
