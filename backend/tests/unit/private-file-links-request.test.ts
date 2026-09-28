/**
 * Every JSON request: our signed links become references before a route reads
 * the body, so a screen that sends a shown link back never saves an expiring one.
 */
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
// Pass-through spy: counts how much signing work one request costs.
vi.mock('@aws-sdk/s3-request-presigner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/s3-request-presigner')>()
  return { ...actual, getSignedUrl: vi.fn(actual.getSignedUrl) }
})
vi.mock('../../src/lib/integrations', () => ({
  getR2Config: vi.fn(async () => state.r2),
  getDoSpacesConfig: vi.fn(async () => null),
  getCloudinaryConfig: vi.fn(async () => null),
}))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { privateFileLinks } from '../../src/lib/private-file-links'
import { createTargetCache, makePrivateRef, signPrivateRef } from '../../src/lib/private-files'

const R2 = {
  endpoint: 'https://0123456789abcdef.r2.cloudflarestorage.com',
  bucket: 'denel-public',
  privateBucket: 'denel-private',
  region: 'auto',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'secretEXAMPLE',
  publicUrl: 'https://pub-test.r2.dev',
}
const KEY = "patients/p 1/Ama's x-ray (1) ü.jpg"
const REF = makePrivateRef('r2', KEY)

let received: unknown
let routeCalls: number
function app(): Hono {
  const a = new Hono()
  a.use('/api/*', privateFileLinks())
  for (const path of ['/api/save', '/api/auth/sign-in/email']) {
    a.post(path, async (c) => {
      routeCalls += 1
      received = await c.req.json()
      return c.json({ ok: true })
    })
  }
  a.post('/api/upload', async (c) => {
    routeCalls += 1
    const form = await c.req.formData()
    received = form.get('note')
    return c.json({ ok: true })
  })
  return a
}
const post = (path: string, body: unknown) =>
  postRaw(path, JSON.stringify(body), 'application/json')
const postRaw = (path: string, text: string, contentType: string) =>
  app().request(path, { method: 'POST', headers: { 'content-type': contentType }, body: text })
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
/** A genuine link, as the screen was shown it `age` ago. */
const sign = (age = 0) =>
  signPrivateRef({ provider: 'r2', key: KEY }, new Date(Date.now() - age), createTargetCache())
const forgeSignature = (link: string) =>
  link.replace(/X-Amz-Signature=[0-9a-f]+/, `X-Amz-Signature=${'0'.repeat(64)}`)

beforeEach(() => {
  state.r2 = R2
  received = undefined
  routeCalls = 0
})
afterEach(() => {
  state.r2 = null
  state.env = { ...BASE_ENV }
})

describe('request layer', () => {
  it('turns our signed link back into its reference (tricky key)', async () => {
    const link = await sign()

    await post('/api/save', { profileImage: link })

    expect(received).toEqual({ profileImage: REF })
  })

  it('converts the &amp; form a rich-text editor writes', async () => {
    const link = (await sign()).replaceAll('&', '&amp;')

    await post('/api/save', { content: `<p>x</p><img src="${link}">` })

    expect(received).toEqual({ content: `<p>x</p><img src="${REF}">` })
  })

  it('converts our link written with escaped slashes', async () => {
    const link = await sign()
    const body = `{"profileImage":"${link.replaceAll('/', '\\/')}"}`

    await postRaw('/api/save', body, 'application/json')

    expect(received).toEqual({ profileImage: REF })
  })

  it('converts a genuine link that expired hours ago', async () => {
    const link = await sign(6 * HOUR)

    await post('/api/save', { profileImage: link })

    expect(received).toEqual({ profileImage: REF })
  })

  it('converts a genuine link up to 7 days old', async () => {
    const link = await sign(6 * DAY)

    await post('/api/save', { profileImage: link })

    expect(received).toEqual({ profileImage: REF })
  })

  it('refuses a genuine link older than 7 days instead of saving a dead link', async () => {
    const link = await sign(8 * DAY)

    const res = await post('/api/save', { profileImage: link })

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'This page is out of date — reload it and save again',
    })
    expect(routeCalls).toBe(0)
  })

  it('leaves a forged link as plain text', async () => {
    const forged = forgeSignature(await sign())

    await post('/api/save', { profileImage: forged })

    expect(received).toEqual({ profileImage: forged })
  })

  it('checks a repeated link once, however often it appears', async () => {
    const forged = forgeSignature(await sign())
    vi.mocked(getSignedUrl).mockClear()

    await post('/api/save', { images: Array.from({ length: 50 }, () => forged) })

    // One probe to learn our link prefix, one signature check.
    expect(vi.mocked(getSignedUrl)).toHaveBeenCalledTimes(2)
  })

  it('refuses a request with more than 200 different file links', async () => {
    const link = await sign()
    const many = Array.from({ length: 201 }, (_, i) => `${link}&n=${i}`)
    vi.mocked(getSignedUrl).mockClear()

    const res = await post('/api/save', { images: many })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'This request contains too many file links' })
    expect(routeCalls).toBe(0)
    expect(vi.mocked(getSignedUrl)).not.toHaveBeenCalled()
  })

  it('accepts a raw reference the backend issued (storage-outage save)', async () => {
    await post('/api/save', { profileImage: REF })

    expect(received).toEqual({ profileImage: REF })
  })

  it('refuses a reference the backend did not issue', async () => {
    const forged = makePrivateRef('r2', 'patients/other/xray.jpg').replace('other', 'victim')

    const res = await post('/api/save', { profileImage: forged })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'This request contains a file reference the server did not issue',
    })
    expect(routeCalls).toBe(0)
  })

  it('refuses a forged reference whatever the content type says', async () => {
    const forged = makePrivateRef('r2', 'patients/other/xray.jpg').replace('other', 'victim')

    const res = await postRaw('/api/save', JSON.stringify({ profileImage: forged }), 'text/plain')

    expect(res.status).toBe(400)
    expect(routeCalls).toBe(0)
  })

  it('refuses a forged reference hidden behind JSON escapes', async () => {
    const forged = makePrivateRef('r2', 'patients/other/xray.jpg').replace('other', 'victim')
    const escaped = `{"profileImage":"\\u0070${forged.slice(1).replaceAll('/', '\\/')}"}`

    const res = await postRaw('/api/save', escaped, 'application/json')

    expect(res.status).toBe(400)
    expect(routeCalls).toBe(0)
  })

  it('skips sign-in requests', async () => {
    const link = await sign()

    await post('/api/auth/sign-in/email', { email: 'a@b.c', note: link })

    expect(received).toEqual({ email: 'a@b.c', note: link })
  })

  it('checks a JSON body that only claims to be a multipart upload', async () => {
    const forged = makePrivateRef('r2', 'staff/other/contract.pdf').replace('other', 'victim')

    const res = await postRaw(
      '/api/save',
      JSON.stringify({ pdfUrl: forged }),
      'multipart/form-data; boundary=x'
    )

    expect(res.status).toBe(400)
    expect(routeCalls).toBe(0)
  })

  it('refuses a body nested too deeply to check', async () => {
    const forged = makePrivateRef('r2', 'staff/other/contract.pdf').replace('other', 'victim')
    const escaped = forged.replaceAll('/', '\\/')
    const deep = `${'['.repeat(6000)}${']'.repeat(6000)}`
    const body = `{"pdfUrl":"${escaped}","padding":${deep}}`

    const res = await postRaw('/api/save', body, 'application/json')

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'This request is nested too deeply to check' })
    expect(routeCalls).toBe(0)
  })

  it('refuses a body over the size limit even when it arrives without a length', async () => {
    const big = `{"note":"${'a'.repeat(1024 * 1024 + 10)}"}`
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(big))
        controller.close()
      },
    })

    const res = await app().request('/api/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit)

    expect(res.status).toBe(413)
    expect(routeCalls).toBe(0)
  })

  it('refuses more than 200 different file references in one request', async () => {
    const refs = Array.from({ length: 201 }, (_, i) => makePrivateRef('r2', `gallery/${i}.jpg`))

    const res = await post('/api/save', { images: refs })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'This request contains too many file links' })
  })

  it('answers 503 with a clear message when PRIVATE_FILE_REF_SECRET is missing', async () => {
    state.env.PRIVATE_FILE_REF_SECRET = undefined

    const res = await postRaw('/api/save', `{"photo":"${REF}"}`, 'application/json')

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'Private files are not set up on this server yet' })
    expect(routeCalls).toBe(0)
  })

  it('leaves multipart uploads alone', async () => {
    const link = await sign()
    const form = new FormData()
    form.append('note', link)

    await app().request('/api/upload', { method: 'POST', body: form })

    expect(received).toBe(link)
  })
})
