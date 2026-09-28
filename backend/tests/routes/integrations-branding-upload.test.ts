/**
 * Branding is the one thing that stays public: the logo, favicon, icons and
 * login photos must have permanent links (emails, login page, installed apps).
 */
import { S3Client } from '@aws-sdk/client-s3'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'

vi.mock('../../src/config/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://localhost:5432/test',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
    BETTER_AUTH_URL: 'http://localhost:3000',
  },
  validateBackendEnv: vi.fn(),
  isDevEnvironment: () => false,
  resolvedEnvironment: () => 'production',
}))
vi.mock('../../src/db', () => ({ getDb: vi.fn(() => ({})) }))
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
vi.mock('../../src/rbac/middleware/verifySession', () => ({
  verifySession:
    () => async (c: { set: (key: string, value: unknown) => void }, next: () => Promise<void>) => {
      c.set('user', {
        id: 'u-admin',
        email: 'admin@framada.app',
        name: 'Admin',
        roleId: 'admin',
        role: 'admin',
      })
      await next()
    },
}))
vi.mock('../../src/rbac/middleware/checkPermission', () => ({
  checkPermission: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))

import { integrationsApp } from '../../src/routes/integrations'

// 1×1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)

let buckets: string[]
beforeEach(() => {
  buckets = []
  vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (command: unknown) => {
    buckets.push((command as { input: { Bucket: string } }).input.Bucket)
    return {} as never
  })
})
afterEach(() => vi.restoreAllMocks())

describe('POST /api/integrations/branding/logo', () => {
  it('stores the logo in the public bucket and returns its permanent link', async () => {
    const app = new Hono<HonoEnv>()
    app.route('/api/integrations', integrationsApp)
    const form = new FormData()
    form.append('file', new File([PNG], 'logo.png', { type: 'image/png' }))
    form.append('kind', 'logo')

    const res = await app.request('/api/integrations/branding/logo', {
      method: 'POST',
      body: form,
    })
    const body = (await res.json()) as { data: { url: string } }

    expect(res.status).toBe(200)
    expect(buckets).toEqual(['denel-public'])
    expect(body.data.url).toBe('https://pub-test.r2.dev/SYS/branding/logo.png')
  })
})
