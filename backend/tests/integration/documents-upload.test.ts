/**
 * `POST /api/documents/instances/upload` — recording a signed scan as a document. See
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.14).
 *
 * The route stored whatever it was sent: no check of the bytes, the content type was whatever the
 * client declared (`text/html` and `image/svg+xml` included), and every file that was not declared
 * a PDF was named `.bin`. F22 gave the generic upload route the same file checks and server-chosen
 * names as every other upload; this endpoint was a direct caller that never went through them.
 *
 * Real stack: the real app, a real administrator's session and real Postgres; only the object store
 * is replaced, to read what was stored.
 *
 * ── Safety ── commits `document_instances` rows titled `IT docs …` and removes them; local Postgres
 * only.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/documents-upload.test.ts
 */
import { ilike } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const stored = vi.hoisted(
  () => [] as Array<{ category: string; key: string; size: number; contentType: string }>
)

vi.mock('../../src/lib/storage-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/storage-router')>()),
  uploadToCategory: vi.fn(
    async (category: string, key: string, body: Buffer, contentType: string) => {
      stored.push({ category, key, size: body.length, contentType })
      return { url: `private-file://r2/${key}#test`, providerId: 'r2' }
    }
  ),
}))
vi.mock('../../src/lib/sms', () => ({
  sendSMS: vi.fn(async () => ({ success: true })),
  getHubtelCredentials: vi.fn(async () => null),
}))

import type { DB } from '../../src/db'
import { documentInstances } from '../../src/db/schema'
import {
  createLoginUser,
  deleteLoginUsers,
  hasBackendSecrets,
  INTERFACES,
  isLocalDb,
  localDb,
  signInAs,
  type TestApp,
} from './_session'

const skip = !(isLocalDb && hasBackendSecrets)
const APP_BOOT_TIMEOUT_MS = 180_000
const db = localDb() as DB
const TAG = `IT docs ${Date.now()}`

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const HTML = Buffer.from('<html><script>alert(1)</script></html>')
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')

let app: TestApp
let cookie = ''
let adminId = ''

async function upload(
  file: { name: string; bytes: Buffer; type: string },
  title = TAG,
  subjectId: string = crypto.randomUUID()
) {
  const form = new FormData()
  form.append('file', new File([file.bytes], file.name, { type: file.type }))
  form.append('subjectType', 'patient')
  form.append('subjectId', subjectId)
  form.append('title', title)
  const { origin, appId } = INTERFACES.portal
  const token = crypto.randomUUID()
  const res = await app.request('/api/documents/instances/upload', {
    method: 'POST',
    headers: {
      Origin: origin,
      'X-App-Id': appId,
      'X-CSRF-Token': token,
      Cookie: `${cookie}; csrf_${appId}=${token}`,
    },
    body: form,
  })
  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
}

const rowsFor = (title: string) =>
  db.select().from(documentInstances).where(ilike(documentInstances.title, title))

describe.skipIf(skip)('recording a signed scan stores only what a scan can be (review)', () => {
  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { validateBackendEnv } = await import('../../src/config/env')
    validateBackendEnv()
    app = (await import('../../src/app')).app as unknown as TestApp
    const email = `docs-admin-${Date.now()}@docs.test`
    adminId = await createLoginUser(db, {
      email,
      name: 'Docs admin',
      roleId: 'admin',
      baRole: 'admin',
    })
    cookie = await signInAs(app, email, 'portal')
  }, APP_BOOT_TIMEOUT_MS)

  afterAll(async () => {
    await db.delete(documentInstances).where(ilike(documentInstances.title, `${TAG}%`))
    await deleteLoginUsers(db, [adminId].filter(Boolean))
  })

  it('records a PDF scan as a .pdf object with the PDF content type', async () => {
    stored.length = 0
    const title = `${TAG} pdf`
    const res = await upload({ name: 'scan.pdf', bytes: PDF, type: 'application/pdf' }, title)
    expect(res.status, JSON.stringify(res.json)).toBe(200)
    expect(stored).toHaveLength(1)
    expect(stored[0].category).toBe('patient_records')
    expect(stored[0].contentType).toBe('application/pdf')
    expect(stored[0].key).toMatch(/^documents\/[0-9a-f-]{36}\.pdf$/)
    expect(await rowsFor(title)).toHaveLength(1)
  })

  it('records a photographed scan under its real extension and content type, not .bin', async () => {
    stored.length = 0
    const title = `${TAG} photo`
    const res = await upload({ name: 'scan.png', bytes: PNG, type: 'image/png' }, title)
    expect(res.status, JSON.stringify(res.json)).toBe(200)
    expect(stored).toHaveLength(1)
    expect(stored[0].contentType).toBe('image/png')
    expect(stored[0].key).toMatch(/^documents\/[0-9a-f-]{36}\.png$/)
  })

  it('refuses a subject that is not an id before storing anything', async () => {
    stored.length = 0
    const title = `${TAG} bad subject`
    const res = await upload(
      { name: 'scan.pdf', bytes: PDF, type: 'application/pdf' },
      title,
      'patient-for-the-test'
    )
    expect(res.status, JSON.stringify(res.json)).toBe(400)
    // Used to be a 500 after the file had already been uploaded.
    expect(stored).toHaveLength(0)
    expect(await rowsFor(title)).toHaveLength(0)
  })

  it.each([
    ['a web page called a PDF', { name: 'scan.pdf', bytes: HTML, type: 'application/pdf' }],
    ['a web page with no declared type', { name: 'scan.pdf', bytes: HTML, type: '' }],
    ['a web page declared as a web page', { name: 'scan.html', bytes: HTML, type: 'text/html' }],
    ['an SVG with a script in it', { name: 'scan.svg', bytes: SVG, type: 'image/svg+xml' }],
    ['a program', { name: 'scan.exe', bytes: Buffer.from('MZ'), type: 'application/octet-stream' }],
    ['an empty file', { name: 'scan.pdf', bytes: Buffer.alloc(0), type: 'application/pdf' }],
  ])('refuses %s, and records nothing', async (label, file) => {
    stored.length = 0
    const title = `${TAG} refused ${label}`
    const res = await upload(file, title)
    expect(res.status, JSON.stringify(res.json)).toBe(400)
    expect(stored).toHaveLength(0)
    expect(await rowsFor(title)).toHaveLength(0)
  })

  it('still asks for the file, the subject and the title', async () => {
    stored.length = 0
    const form = new FormData()
    form.append('title', `${TAG} incomplete`)
    const { origin, appId } = INTERFACES.portal
    const token = crypto.randomUUID()
    const res = await app.request('/api/documents/instances/upload', {
      method: 'POST',
      headers: {
        Origin: origin,
        'X-App-Id': appId,
        'X-CSRF-Token': token,
        Cookie: `${cookie}; csrf_${appId}=${token}`,
      },
      body: form,
    })
    expect(res.status).toBe(400)
    expect(stored).toHaveLength(0)
  })
})
