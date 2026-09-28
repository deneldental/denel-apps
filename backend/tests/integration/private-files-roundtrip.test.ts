/**
 * The whole path, on a real database with a fake object store: upload → the
 * screen receives a link → it saves that link on a record → the database holds
 * the reference → reading the record returns a fresh link. Commits rows, so it
 * refuses anything but a local Postgres and deletes what it created.
 *
 *   DATABASE_URL=postgresql://framada:framada@localhost:5499/framada \
 *     npx vitest run tests/integration/private-files-roundtrip.test.ts
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { Hono } from 'hono'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'

const RAW_DB_URL = process.env.DATABASE_URL ?? ''
const IS_LOCAL = /@(localhost|127\.0\.0\.1|host\.docker\.internal)([:/]|$)/.test(RAW_DB_URL)

vi.mock('../../src/config/env', () => ({
  env: {
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://localhost:5499/framada',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
    PRIVATE_FILE_REF_SECRET: 'test-file-ref-secret-at-least-32-characters',
    BETTER_AUTH_URL: 'http://localhost:3000',
    NODE_ENV: 'test',
  },
  validateBackendEnv: vi.fn(),
  isSelfHealEnabled: () => false,
  isDevEnvironment: () => false,
  resolvedEnvironment: () => 'production',
}))
vi.mock('../../src/lib/rbac')
vi.mock('../../src/lib/audit', () => ({
  createAuditLog: vi.fn(),
  recordDiffAudit: vi.fn(),
  computeChangedFields: vi.fn(() => ({})),
  redactForAudit: vi.fn((row: unknown) => row),
  auditMiddleware: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../src/lib/sms', () => ({
  sendSMS: vi.fn(async () => ({ success: true })),
  // routes/patients.ts imports this; a mock without it fails the import.
  DEFAULT_SMS_TEMPLATES: { welcome: 'welcome {Patientname}' },
}))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))
vi.mock('../../src/lib/integrations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/integrations')>()),
  getR2Config: vi.fn(async () => ({
    endpoint: 'https://0123456789abcdef.r2.cloudflarestorage.com',
    bucket: 'denel-public',
    privateBucket: 'denel-private',
    region: 'auto',
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'secretEXAMPLE',
    publicUrl: 'https://pub-test.r2.dev',
  })),
  getStorageRouting: vi.fn(async () => null),
}))

import { eq, sql } from 'drizzle-orm'
import { type DB, getDb } from '../../src/db'
import { patients, staffMemos, staffRegistrationInvites } from '../../src/db/schema'
import { privateFileLinks } from '../../src/lib/private-file-links'
import { parsePrivateRef } from '../../src/lib/private-files'
import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { patientsApp } from '../../src/routes/patients'
import { staffMemosApp } from '../../src/routes/staff-memos'
import { staffRegistrationApp } from '../../src/routes/staff-registration'
import { uploadApp } from '../../src/routes/upload'
import { sweepLeakedFixtures } from './_fixtures'

const TAG = `pf-${Date.now()}`
const PRIVATE_HOST = 'denel-private.0123456789abcdef.r2.cloudflarestorage.com'
// 1×1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)

let db: DB
let adminUserId: string
let patientId: string
const created = { memos: [] as string[], invites: [] as string[] }
const store = new Map<string, Uint8Array>()

function app(): Hono<HonoEnv> {
  const a = new Hono<HonoEnv>()
  a.use('/api/*', privateFileLinks())
  a.route('/api/upload', uploadApp)
  a.route('/api/patients', patientsApp)
  a.route('/api/staff', staffMemosApp)
  a.route('/api/staff-registration', staffRegistrationApp)
  return a
}
const json = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

describe.skipIf(!IS_LOCAL)('private files — round trip on a real database', () => {
  beforeAll(async () => {
    db = getDb(RAW_DB_URL)
    await sweepLeakedFixtures()
    const users = await db.execute<{ id: string }>(
      sql`SELECT id FROM "user" ORDER BY "createdAt" LIMIT 1`
    )
    adminUserId = users.rows[0]?.id
    if (!adminUserId) throw new Error('No rows in "user" — run seed-admin first')
    const [p] = await db
      .insert(patients)
      .values({ name: `IT Private Files ${TAG}`, dob: new Date('1990-01-01'), gender: 'other' })
      .returning({ id: patients.id })
    patientId = p.id
  })

  afterAll(async () => {
    if (!db) return
    for (const id of created.memos) await db.delete(staffMemos).where(eq(staffMemos.id, id))
    for (const id of created.invites)
      await db.delete(staffRegistrationInvites).where(eq(staffRegistrationInvites.id, id))
    await sweepLeakedFixtures()
  })

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: adminUserId,
      email: 'admin@framada.app',
      name: 'Admin',
      role: 'admin',
      roleId: 'admin',
    })
    vi.mocked(checkPermission).mockResolvedValue(true)
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (command: unknown) => {
      if (command instanceof PutObjectCommand) {
        const { Bucket, Key, Body } = command.input
        store.set(`${Bucket}/${Key}`, new Uint8Array(Body as Buffer))
        return {} as never
      }
      if (command instanceof GetObjectCommand) {
        const bytes = store.get(`${command.input.Bucket}/${command.input.Key}`)
        return { Body: { transformToByteArray: async () => bytes } } as never
      }
      if (command instanceof DeleteObjectCommand) return {} as never
      throw new Error('unexpected S3 command')
    })
  })

  it('a patient photo: link on screen, reference in the database, fresh link on read, kept on re-save', async () => {
    const form = new FormData()
    form.append('file', new File([PNG], 'photo.png', { type: 'image/png' }))
    form.append('storageCategory', 'patient_records')
    form.append('folder', `patients/${patientId}`)
    const upload = (await (
      await app().request('/api/upload', { method: 'POST', body: form })
    ).json()) as {
      url: string
    }

    expect(new URL(upload.url).host).toBe(PRIVATE_HOST)

    const saved = await app().request(
      `/api/patients/${patientId}`,
      json('PATCH', { profileImage: upload.url })
    )
    expect(saved.status).toBe(200)

    const [row] = await db
      .select({ profileImage: patients.profileImage })
      .from(patients)
      .where(eq(patients.id, patientId))
    expect(parsePrivateRef(row.profileImage ?? '')?.key).toMatch(
      new RegExp(`^patients/${patientId}/`)
    )

    const read = (await (await app().request(`/api/patients/${patientId}`)).json()) as {
      data: { profileImage: string }
    }
    expect(new URL(read.data.profileImage).host).toBe(PRIVATE_HOST)

    // The Edit sheet sends every field back, the shown photo link included.
    const resaved = await app().request(
      `/api/patients/${patientId}`,
      json('PATCH', { profileImage: read.data.profileImage, occupation: `Tester ${TAG}` })
    )
    expect(resaved.status).toBe(200)
    const [after] = await db
      .select({ profileImage: patients.profileImage })
      .from(patients)
      .where(eq(patients.id, patientId))
    expect(after.profileImage).toBe(row.profileImage)
  })

  it('a memo image survives the editor round trip (&amp; form) and the sanitiser', async () => {
    const form = new FormData()
    form.append('file', new File([PNG], 'diagram.png', { type: 'image/png' }))
    form.append('folder', 'memos')
    const upload = (await (
      await app().request('/api/upload', { method: 'POST', body: form })
    ).json()) as {
      url: string
    }
    // The editor holds the signed link it was shown, not the stored reference.
    expect(new URL(upload.url).host).toBe(PRIVATE_HOST)
    const html = `<p>See</p><img src="${upload.url.replaceAll('&', '&amp;')}">`

    const res = await app().request(
      '/api/staff/memos',
      json('POST', { title: `IT memo ${TAG}`, content: html })
    )
    const body = (await res.json()) as { data: { id: string } }
    created.memos.push(body.data.id)

    const [memo] = await db
      .select({ content: staffMemos.content })
      .from(staffMemos)
      .where(eq(staffMemos.id, body.data.id))
    expect(memo.content).toContain('src="private-file://r2/memos/')
  })

  it('a staff CV is stored privately', async () => {
    const [invite] = await db
      .insert(staffRegistrationInvites)
      .values({
        token: `it-${TAG}`,
        status: 'pending',
        phoneVerified: true,
        expiresAt: new Date(Date.now() + 86_400_000),
      })
      .returning({ id: staffRegistrationInvites.id })
    created.invites.push(invite.id)
    const form = new FormData()
    form.append(
      'file',
      new File([Buffer.from('%PDF-1.4\n%%EOF')], 'cv.pdf', { type: 'application/pdf' })
    )

    const res = await app().request(`/api/staff-registration/public/it-${TAG}/cv`, {
      method: 'POST',
      body: form,
    })
    expect(res.status).toBe(200)

    const [row] = await db
      .select({ cvUrl: staffRegistrationInvites.cvUrl })
      .from(staffRegistrationInvites)
      .where(eq(staffRegistrationInvites.id, invite.id))
    expect(parsePrivateRef(row.cvUrl ?? '')?.key).toMatch(/^staff\/registration\//)
  })
})
