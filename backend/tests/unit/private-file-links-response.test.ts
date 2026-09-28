/**
 * Every JSON response: stored references become 60–75 minute signed links.
 */
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  r2: null as Record<string, unknown> | null,
  env: {} as Record<string, string | undefined>,
}))
const BASE_ENV = {
  DATABASE_URL: 'postgresql://localhost:5432/test',
  BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
  PRIVATE_FILE_REF_SECRET: 'test-file-ref-secret-at-least-32-characters',
}
state.env = { ...BASE_ENV }

vi.mock('../../src/config/env', () => ({
  env: new Proxy({}, { get: (_t, prop: string) => state.env[prop] }),
}))
vi.mock('../../src/lib/integrations', () => ({
  getR2Config: vi.fn(async () => state.r2),
  getDoSpacesConfig: vi.fn(async () => null),
  getCloudinaryConfig: vi.fn(async () => null),
}))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { getR2Config } from '../../src/lib/integrations'
import { logError } from '../../src/lib/logger'
import { privateFileLinks } from '../../src/lib/private-file-links'
import { makePrivateRef } from '../../src/lib/private-files'

const R2 = {
  endpoint: 'https://0123456789abcdef.r2.cloudflarestorage.com',
  bucket: 'denel-public',
  privateBucket: 'denel-private',
  region: 'auto',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'secretEXAMPLE',
  publicUrl: 'https://pub-test.r2.dev',
}
const PRIVATE_HOST = 'denel-private.0123456789abcdef.r2.cloudflarestorage.com'
const photo = makePrivateRef('r2', 'patients/p1/photo.jpg')
const scan = makePrivateRef('r2', 'patients/p1/scan.jpg')

function appWith(route: (app: Hono) => void): Hono {
  const app = new Hono()
  app.use('*', privateFileLinks())
  route(app)
  return app
}

afterEach(() => {
  state.r2 = null
  state.env = { ...BASE_ENV }
  vi.clearAllMocks()
})

describe('response layer', () => {
  it('replaces references in nested JSON and in HTML strings with signed links', async () => {
    state.r2 = R2
    const app = appWith((a) =>
      a.get('/x', (c) =>
        c.json({ patient: { photo }, gallery: [scan], memo: `<p>Hi</p><img src="${scan}">` })
      )
    )

    const res = await app.request('/x')
    const text = await res.text()
    const body = JSON.parse(text) as { patient: { photo: string }; gallery: string[]; memo: string }

    expect(text).not.toContain('private-file://')
    expect(new URL(body.patient.photo).host).toBe(PRIVATE_HOST)
    expect(body.memo).toContain(`src="${body.gallery[0]}"`)
  })

  it('signs a repeated reference once and gives it the same link', async () => {
    state.r2 = R2
    const app = appWith((a) => a.get('/x', (c) => c.json({ a: photo, b: photo })))

    const body = (await (await app.request('/x')).json()) as { a: string; b: string }

    expect(body.b).toBe(body.a)
  })

  it('leaves non-JSON responses untouched', async () => {
    state.r2 = R2
    const app = appWith((a) =>
      a.get('/csv', (c) => c.text(`file\n${photo}`, 200, { 'content-type': 'text/csv' }))
    )

    expect(await (await app.request('/csv')).text()).toBe(`file\n${photo}`)
  })

  it('keeps the status, both Set-Cookie headers, and no stale Content-Length', async () => {
    state.r2 = R2
    const app = appWith((a) =>
      a.get('/x', () => {
        const body = JSON.stringify({ photo })
        const headers = new Headers({
          'content-type': 'application/json',
          'content-length': String(body.length),
        })
        headers.append('set-cookie', 'a=1; Path=/')
        headers.append('set-cookie', 'b=2; Path=/')
        return new Response(body, { status: 201, headers })
      })
    )

    const res = await app.request('/x')
    const text = await res.text()

    expect(res.status).toBe(201)
    expect(res.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/'])
    const length = res.headers.get('content-length')
    expect(length === null || Number(length) === Buffer.byteLength(text)).toBe(true)
  })

  it('reads the storage settings once for hundreds of files', async () => {
    state.r2 = R2
    const refs = Array.from({ length: 200 }, (_, i) => makePrivateRef('r2', `gallery/${i}.jpg`))
    const app = appWith((a) => a.get('/x', (c) => c.json({ refs })))

    const body = (await (await app.request('/x')).json()) as { refs: string[] }

    expect(body.refs.every((u) => u.startsWith(`https://${PRIVATE_HOST}/`))).toBe(true)
    expect(vi.mocked(getR2Config)).toHaveBeenCalledTimes(1)
  })

  it('keeps references in a response a route marks as a backup export', async () => {
    state.r2 = R2
    const app = appWith((a) =>
      a.get('/export', (c) => {
        c.set('keepPrivateRefs' as never, true as never)
        return c.json({ data: [{ pdfUrl: photo }] })
      })
    )

    expect(await (await app.request('/export')).json()).toEqual({ data: [{ pdfUrl: photo }] })
  })

  it('never signs a reference the server did not issue', async () => {
    state.r2 = R2
    // A record a client managed to point at someone else's file.
    const forged = makePrivateRef('r2', 'consent-forms/other.pdf').replace('other', 'victim')
    const app = appWith((a) => a.get('/x', (c) => c.json({ planted: forged, own: photo })))

    const body = (await (await app.request('/x')).json()) as { planted: string; own: string }

    expect(body.planted).toBe(forged)
    expect(new URL(body.own).host).toBe(PRIVATE_HOST)
  })

  it('still answers without PRIVATE_FILE_REF_SECRET: references stay, error logged once', async () => {
    state.r2 = R2
    const app = appWith((a) => a.get('/x', (c) => c.json({ a: photo, b: scan })))
    state.env.PRIVATE_FILE_REF_SECRET = undefined

    const res = await app.request('/x')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ a: photo, b: scan })
    expect(vi.mocked(logError)).toHaveBeenCalledTimes(1)
  })

  it('still answers when signing fails: references stay, error logged once', async () => {
    state.r2 = { ...R2, privateBucket: '' }
    const app = appWith((a) => a.get('/x', (c) => c.json({ a: photo, b: scan })))

    const res = await app.request('/x')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ a: photo, b: scan })
    expect(vi.mocked(logError)).toHaveBeenCalledTimes(1)
  })
})
