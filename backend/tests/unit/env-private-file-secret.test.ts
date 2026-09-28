/**
 * A deployed backend without PRIVATE_FILE_REF_SECRET could neither store nor
 * show a private file, so it must refuse to start; local development may run
 * without it (private files are simply unavailable until it is set).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const BASE: Record<string, string | undefined> = {
  DATABASE_URL: 'postgresql://framada:framada@localhost:5499/framada',
  BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
  BETTER_AUTH_URL: 'http://localhost:3000',
  TRUSTED_IP_MODE: 'enforce',
  // Pinned so the caller's shell cannot decide the outcome.
  APP_ENV: undefined,
}

async function validate(overrides: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries({ ...BASE, ...overrides })) vi.stubEnv(key, value)
  const { validateBackendEnv } = await import('../../src/config/env')
  return () => validateBackendEnv()
}

beforeEach(() => {
  vi.resetModules()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('PRIVATE_FILE_REF_SECRET at startup', () => {
  it('refuses to start production without it', async () => {
    const run = await validate({ NODE_ENV: 'production', PRIVATE_FILE_REF_SECRET: undefined })

    expect(run).toThrow('PRIVATE_FILE_REF_SECRET is not set')
  })

  it('refuses to start staging without it', async () => {
    const run = await validate({
      NODE_ENV: 'production',
      APP_ENV: 'staging',
      PRIVATE_FILE_REF_SECRET: undefined,
    })

    expect(run).toThrow('PRIVATE_FILE_REF_SECRET is not set')
  })

  it('starts production with it', async () => {
    const run = await validate({
      NODE_ENV: 'production',
      PRIVATE_FILE_REF_SECRET: 'test-file-ref-secret-at-least-32-characters',
    })

    expect(run).not.toThrow()
  })

  it('lets local development start without it', async () => {
    const run = await validate({ NODE_ENV: 'development', PRIVATE_FILE_REF_SECRET: undefined })

    expect(run).not.toThrow()
  })
})
