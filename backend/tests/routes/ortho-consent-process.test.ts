/**
 * `POST /api/ortho-consent/process` — a scanned consent form must never replace another. See
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.14).
 *
 * The processed PDF was stored as `consent-forms/<patient name>_<ddMMMyyyy>.pdf`. Two patients with
 * the same name processed on the same day (a common name on a busy day), or the same patient twice,
 * wrote to the same key, and a plain PutObject overwrites: the earlier patient's signed consent
 * form was replaced by the later one's, and the first patient's record then pointed at someone
 * else's document. The key now ends in random bits, like every other object the backend names.
 */
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'

vi.mock('../../src/config/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://localhost:5432/test',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
    BETTER_AUTH_URL: 'http://localhost:3000',
    NODE_ENV: 'test',
  },
  validateBackendEnv: vi.fn(),
}))
vi.mock('../../src/lib/rbac')
vi.mock('../../src/db', () => ({ getDb: vi.fn(() => ({})) }))
vi.mock('../../src/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('../../src/lib/pdf-utils', () => ({
  validateConsentFormUpload: vi.fn(async () => ({ valid: true })),
  processUploadedConsentForm: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
}))
vi.mock('../../src/lib/storage-router', () => ({
  uploadToCategory: vi.fn(async (_category: string, key: string) => ({
    url: `private-file://r2/${key}#t`,
  })),
}))

import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { uploadToCategory } from '../../src/lib/storage-router'
import { orthoConsentApp } from '../../src/routes/ortho-consent'

const mockGetCurrentUser = vi.mocked(getCurrentUser)
const mockCheckPermission = vi.mocked(checkPermission)
const mockUpload = vi.mocked(uploadToCategory)

const app = new Hono<HonoEnv>()
app.route('/api/ortho-consent', orthoConsentApp)

function processForm(patientName: string, type = 'application/pdf') {
  const form = new FormData()
  form.append('file', new File([new Uint8Array([37, 80, 68, 70])], 'scan.pdf', { type }))
  form.append('patientName', patientName)
  return app.request('/api/ortho-consent/process', { method: 'POST', body: form })
}

beforeEach(() => {
  vi.stubEnv('PDF_TEMPLATE_BASE_URL', 'https://templates.example.test')
  mockGetCurrentUser.mockResolvedValue({
    id: 'u-1',
    email: 'staff@deneldental.com',
    name: 'Staff',
    role: 'user',
    roleId: 'receptionist',
  })
  mockCheckPermission.mockResolvedValue(true)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('POST /api/ortho-consent/process — the stored name', () => {
  it('gives two forms for the same name on the same day two different objects', async () => {
    const first = await processForm('Ama Mensah')
    const second = await processForm('Ama Mensah')
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)

    const [one, two] = mockUpload.mock.calls.map((call) => call[1])
    expect(one).not.toBe(two)
    expect(mockUpload.mock.calls.every((call) => call[0] === 'patient_records')).toBe(true)
  })

  it('keeps the readable part, then random bits, then the extension', async () => {
    await processForm('Ama Mensah')
    const key = mockUpload.mock.calls[0][1]
    expect(key).toMatch(/^consent-forms\/ama_mensah_\d{2}[a-z]{3}\d{4}-[0-9a-f]{16}\.pdf$/)
  })

  it('turns a name that tries to be a path into a harmless label', async () => {
    await processForm('../../etc/passwd')
    const key = mockUpload.mock.calls[0][1]
    expect(key).toMatch(/^consent-forms\/[a-z0-9_]+_\d{2}[a-z]{3}\d{4}-[0-9a-f]{16}\.pdf$/)
    expect(key).not.toContain('..')
    expect(key.split('/')).toHaveLength(2)
  })

  it('answers with the stored address', async () => {
    const res = await processForm('Ama Mensah')
    const body = (await res.json()) as { success: boolean; url: string }
    expect(body.success).toBe(true)
    expect(body.url).toBe(`private-file://r2/${mockUpload.mock.calls[0][1]}#t`)
  })
})

describe('POST /api/ortho-consent/process — what it still refuses', () => {
  it('refuses a caller without ortho_consent:create, and stores nothing', async () => {
    mockCheckPermission.mockResolvedValue(false)
    expect((await processForm('Ama Mensah')).status).toBe(403)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('refuses a file that is not a PDF, and stores nothing', async () => {
    expect((await processForm('Ama Mensah', 'image/png')).status).toBe(400)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('refuses a request with no patient name', async () => {
    const form = new FormData()
    form.append(
      'file',
      new File([new Uint8Array([37, 80, 68, 70])], 'scan.pdf', { type: 'application/pdf' })
    )
    const res = await app.request('/api/ortho-consent/process', { method: 'POST', body: form })
    expect(res.status).toBe(400)
    expect(mockUpload).not.toHaveBeenCalled()
  })
})
