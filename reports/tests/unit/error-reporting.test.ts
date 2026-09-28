/**
 * Reports had a production DSN requirement but no Sentry wiring — the DSN did
 * nothing. Now it reports like the other apps: init only with a DSN, tag events
 * with the deploy environment (not Vite's build MODE), never throw.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  init: vi.fn(),
  capture: vi.fn(),
}))

vi.mock('../../src/config/env', () => ({
  env: new Proxy({}, { get: (_t, k: string) => state.env[k] }),
}))
vi.mock('@sentry/react', () => ({ init: state.init, captureException: state.capture }))

beforeEach(() => {
  vi.resetModules()
  state.init.mockClear()
  state.capture.mockClear()
  state.env = {
    VITE_SENTRY_DSN: 'https://examplePublicKey@o0.ingest.sentry.io/0',
    VITE_APP_ENV: 'staging',
    MODE: 'production',
  }
})
afterEach(() => vi.clearAllMocks())

describe('reports error reporting', () => {
  it('initialises Sentry with the deploy environment', async () => {
    const { initErrorReporting } = await import('../../src/lib/error-reporting')

    await initErrorReporting()

    expect(state.init).toHaveBeenCalledTimes(1)
    expect(state.init.mock.calls[0][0]).toMatchObject({ environment: 'staging' })
  })

  it('does nothing without a DSN', async () => {
    state.env.VITE_SENTRY_DSN = undefined
    const { initErrorReporting } = await import('../../src/lib/error-reporting')

    await initErrorReporting()

    expect(state.init).not.toHaveBeenCalled()
  })

  it('reports an error to Sentry once initialised', async () => {
    const mod = await import('../../src/lib/error-reporting')
    await mod.initErrorReporting()

    mod.reportError(new Error('boom'), { scope: 'test' })

    expect(state.capture).toHaveBeenCalledTimes(1)
  })
})
