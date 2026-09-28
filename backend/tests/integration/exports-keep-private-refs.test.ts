/**
 * Settings and table exports are backups: they must carry the permanent private
 * references, not links that expire within the hour, so an export can be
 * re-imported any time later. Real database; storage configured so that any
 * reference in an ordinary response WOULD be signed.
 *
 *   DATABASE_URL=postgresql://framada:framada@localhost:5499/framada \
 *     npx vitest run tests/integration/exports-keep-private-refs.test.ts
 */
import { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
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
vi.mock('../../src/lib/rbac', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/rbac')>()),
  getCurrentUser: vi.fn(async () => ({ id: 'u-admin', role: 'admin', roleId: 'admin' })),
  isAdmin: vi.fn(async () => true),
  isAdminUser: vi.fn(() => true),
}))
vi.mock('../../src/lib/audit', () => ({
  createAuditLog: vi.fn(),
  recordDiffAudit: vi.fn(),
  computeChangedFields: vi.fn(() => ({})),
  redactForAudit: vi.fn((row: unknown) => row),
  auditMiddleware: () => async (_c: unknown, next: () => Promise<void>) => next(),
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
}))

import { eq } from 'drizzle-orm'
import { getDb } from '../../src/db'
import { consentTemplates, patients } from '../../src/db/schema'
import { privateFileLinks } from '../../src/lib/private-file-links'
import { makePrivateRef } from '../../src/lib/private-files'
import { databaseApp } from '../../src/routes/database'
import { settingsApp } from '../../src/routes/settings'

const TAG = `ex-${Date.now()}`
const TEMPLATE_REF = makePrivateRef('r2', `consent-templates/${TAG}.pdf`)
const PHOTO_REF = makePrivateRef('r2', `avatars/${TAG}.jpg`)

function app(): Hono<HonoEnv> {
  const a = new Hono<HonoEnv>()
  a.use('/api/*', privateFileLinks())
  a.route('/api/settings', settingsApp)
  a.route('/api/database', databaseApp)
  return a
}

describe.skipIf(!IS_LOCAL)('exports keep permanent file references', () => {
  let templateId: string
  let patientId: string

  beforeAll(async () => {
    const db = getDb(RAW_DB_URL)
    const [t] = await db
      .insert(consentTemplates)
      .values({ name: `IT consent ${TAG}`, pdfUrl: TEMPLATE_REF })
      .returning({ id: consentTemplates.id })
    templateId = t.id
    const [p] = await db
      .insert(patients)
      .values({
        name: `IT Export ${TAG}`,
        dob: new Date('1990-01-01'),
        gender: 'other',
        profileImage: PHOTO_REF,
      })
      .returning({ id: patients.id })
    patientId = p.id
  })

  afterAll(async () => {
    const db = getDb(RAW_DB_URL)
    if (templateId) await db.delete(consentTemplates).where(eq(consentTemplates.id, templateId))
    if (patientId) await db.delete(patients).where(eq(patients.id, patientId))
  })

  it('the settings export carries the reference, not an expiring link', async () => {
    const text = await (await app().request('/api/settings/export')).text()

    expect(text).toContain(TEMPLATE_REF)
    expect(text).not.toContain('X-Amz-Signature')
  })

  it('a table export carries the reference, not an expiring link', async () => {
    const text = await (await app().request('/api/database/export/patients')).text()

    expect(text).toContain(PHOTO_REF)
    expect(text).not.toContain('X-Amz-Signature')
  })
})
