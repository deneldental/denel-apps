/**
 * F13 — a deployed backend that does not know where the portal and the patient app live must
 * refuse to start, instead of sending patients links to the wrong place. See
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.13).
 *
 * `PORTAL_URL` and `PATIENT_PORTAL_URL` were optional. Without them an appointment-confirmation SMS
 * pointed at the patient app (which has no /c/:token page), an X-ray share link too, and four more
 * routes fell back to `http://localhost:5173`. The deploy did not check for them either. Staging and
 * production now have to state both, and neither may point at the machine itself; local development
 * is exempt.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const BASE: Record<string, string | undefined> = {
  DATABASE_URL: 'postgresql://framada:framada@localhost:5499/framada',
  BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
  BETTER_AUTH_URL: 'http://localhost:3000',
  TRUSTED_IP_MODE: 'enforce',
  PRIVATE_FILE_REF_SECRET: 'test-file-ref-secret-at-least-32-characters',
  PORTAL_URL: undefined,
  PATIENT_PORTAL_URL: undefined,
  // Pinned so the caller's shell cannot decide the outcome.
  APP_ENV: undefined,
}

const GOOD = {
  PORTAL_URL: 'https://portal.deneldental.com',
  PATIENT_PORTAL_URL: 'https://app.deneldental.com',
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

describe('PORTAL_URL and PATIENT_PORTAL_URL at startup', () => {
  it.each([
    ['production', { NODE_ENV: 'production' }],
    ['staging', { NODE_ENV: 'production', APP_ENV: 'staging' }],
  ])('start %s when both are set', async (_name, vars) => {
    expect(await validate({ ...vars, ...GOOD })).not.toThrow()
  })

  it.each([
    ['production', { NODE_ENV: 'production' }],
    ['staging', { NODE_ENV: 'production', APP_ENV: 'staging' }],
  ])('refuse to start %s without PORTAL_URL', async (_name, vars) => {
    const run = await validate({ ...vars, ...GOOD, PORTAL_URL: undefined })
    expect(run).toThrow('PORTAL_URL is not set')
  })

  it('refuses to start without PATIENT_PORTAL_URL', async () => {
    const run = await validate({ NODE_ENV: 'production', ...GOOD, PATIENT_PORTAL_URL: undefined })
    expect(run).toThrow('PATIENT_PORTAL_URL is not set')
  })

  it('names both when both are missing, and says what would break', async () => {
    const run = await validate({ NODE_ENV: 'production' })
    expect(run).toThrow(/PORTAL_URL is not set/)
    expect(run).toThrow(/PATIENT_PORTAL_URL is not set/)
    expect(run).toThrow(/confirmation/i)
  })

  it.each([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://127.4.5.6',
    'http://0.0.0.0:3000',
    'http://[::1]:5173',
    'http://portal.localhost:5173',
  ])('refuses an address that points at the machine itself (%s)', async (address) => {
    const run = await validate({ NODE_ENV: 'production', ...GOOD, PORTAL_URL: address })
    expect(run).toThrow('PORTAL_URL points at this machine')
  })

  it('refuses a patient-app address that points at the machine itself too', async () => {
    const run = await validate({
      NODE_ENV: 'production',
      ...GOOD,
      PATIENT_PORTAL_URL: 'http://localhost:5177',
    })
    expect(run).toThrow('PATIENT_PORTAL_URL points at this machine')
  })

  it('lets a real address that merely contains the word local through', async () => {
    const run = await validate({
      NODE_ENV: 'production',
      ...GOOD,
      PORTAL_URL: 'https://localhost-clinic.example.test',
    })
    expect(run).not.toThrow()
  })

  it('does not remember a refused configuration: the next caller is refused too', async () => {
    const run = await validate({ NODE_ENV: 'production' })
    expect(run).toThrow('PORTAL_URL is not set')
    expect(run).toThrow('PORTAL_URL is not set') // it used to be cached before the checks ran
  })

  it('lets local development start without either', async () => {
    expect(await validate({ NODE_ENV: 'development' })).not.toThrow()
  })

  it('lets local development use the local servers', async () => {
    const run = await validate({
      NODE_ENV: 'development',
      PORTAL_URL: 'http://localhost:5173',
      PATIENT_PORTAL_URL: 'http://localhost:5177',
    })
    expect(run).not.toThrow()
  })
})
