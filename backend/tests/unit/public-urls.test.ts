/**
 * F13 — the two addresses people are sent to by a link. See
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.13).
 *
 * The clinic PORTAL serves the token pages (`/c/:token` appointment confirmation, `/xray-share/:token`,
 * document signing) and receives people back from Google; the PATIENT app is where a patient is told
 * to sign in. Each route that builds such a link used to carry its own fallback: two of them sent
 * patients and referring doctors to the patient app's host for pages that exist only in the portal,
 * four fell back to `http://localhost:5173`, and nothing stopped a deploy from starting without
 * either address. `lib/public-urls.ts` is now the one place that decides.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { patientAppUrl, portalLink, portalUrl } from '../../src/lib/public-urls'

const PORTAL = 'https://portal.example.test'
const PATIENT_APP = 'https://app.example.test'

function environment(vars: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries({
    NODE_ENV: 'development',
    APP_ENV: undefined,
    PORTAL_URL: undefined,
    PATIENT_PORTAL_URL: undefined,
    ...vars,
  })) {
    vi.stubEnv(key, value)
  }
}

beforeEach(() => vi.unstubAllEnvs())
afterEach(() => vi.unstubAllEnvs())

describe('portalUrl / patientAppUrl — configured', () => {
  it('uses the configured address', () => {
    environment({ NODE_ENV: 'production', PORTAL_URL: PORTAL, PATIENT_PORTAL_URL: PATIENT_APP })
    expect(portalUrl()).toBe(PORTAL)
    expect(patientAppUrl()).toBe(PATIENT_APP)
  })

  it('keeps the two apart: the portal host is not the patient app host', () => {
    environment({ NODE_ENV: 'production', PORTAL_URL: PORTAL, PATIENT_PORTAL_URL: PATIENT_APP })
    expect(portalUrl()).not.toBe(patientAppUrl())
  })

  it.each([
    [`${PORTAL}/`, PORTAL],
    [`${PORTAL}///`, PORTAL],
    [`  ${PORTAL}  `, PORTAL],
    [`${PORTAL}/base`, `${PORTAL}/base`],
  ])('tidies %j into %j so a link never has a double slash', (configured, expected) => {
    environment({ NODE_ENV: 'production', PORTAL_URL: configured, PATIENT_PORTAL_URL: PATIENT_APP })
    expect(portalUrl()).toBe(expected)
  })

  it.each(['staging', 'production'] as const)('is the same in %s as anywhere', (name) => {
    environment({
      NODE_ENV: 'production',
      APP_ENV: name,
      PORTAL_URL: PORTAL,
      PATIENT_PORTAL_URL: PATIENT_APP,
    })
    expect(portalUrl()).toBe(PORTAL)
  })
})

describe('portalUrl / patientAppUrl — not configured', () => {
  it('falls back to the local dev servers on a developer machine, and only there', () => {
    environment({})
    expect(portalUrl()).toBe('http://localhost:5173')
    expect(patientAppUrl()).toBe('http://localhost:5177')
  })

  it('never falls back to the patient app for a portal page (the old default)', () => {
    environment({})
    expect(portalUrl()).not.toContain('deneldental.com')
  })

  it.each([
    ['production', { NODE_ENV: 'production' }],
    ['staging', { NODE_ENV: 'production', APP_ENV: 'staging' }],
    ['an unrecognised environment name', { NODE_ENV: 'prod' }],
  ])('refuses to guess in %s', (_name, vars) => {
    environment(vars)
    expect(() => portalUrl()).toThrow('PORTAL_URL is not set')
    expect(() => patientAppUrl()).toThrow('PATIENT_PORTAL_URL is not set')
  })

  it('counts an empty or blank value as not set', () => {
    environment({ NODE_ENV: 'production', PORTAL_URL: '   ', PATIENT_PORTAL_URL: '' })
    expect(() => portalUrl()).toThrow('PORTAL_URL is not set')
    expect(() => patientAppUrl()).toThrow('PATIENT_PORTAL_URL is not set')
  })
})

describe('portalLink', () => {
  beforeEach(() =>
    environment({
      NODE_ENV: 'production',
      PORTAL_URL: `${PORTAL}/`,
      PATIENT_PORTAL_URL: PATIENT_APP,
    })
  )

  it('puts a path on the portal host', () => {
    expect(portalLink('/c/abc')).toBe(`${PORTAL}/c/abc`)
    expect(portalLink('xray-share/abc')).toBe(`${PORTAL}/xray-share/abc`)
  })

  it('reads the address when asked, not when the file loads', () => {
    expect(portalLink('/x')).toBe(`${PORTAL}/x`)
    environment({
      NODE_ENV: 'production',
      PORTAL_URL: 'https://moved.example.test',
      PATIENT_PORTAL_URL: PATIENT_APP,
    })
    expect(portalLink('/x')).toBe('https://moved.example.test/x')
  })
})
