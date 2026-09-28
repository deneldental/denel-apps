/**
 * Integrations → R2: the private bucket is saved and shown, Test checks both
 * buckets with a list call (least-privilege tokens cannot HeadBucket), and
 * usage adds both buckets up.
 */
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'

const R2 = {
  endpoint: 'https://0123456789abcdef.r2.cloudflarestorage.com',
  bucket: 'denel-public',
  privateBucket: 'denel-private',
  region: 'auto',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'secretEXAMPLE',
  publicUrl: 'https://pub-test.r2.dev',
}

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

let listed: string[]
let failBucket: string | null
beforeEach(() => {
  listed = []
  failBucket = null
  vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (command: unknown) => {
    if (!(command instanceof ListObjectsV2Command)) throw new Error('unexpected command')
    const bucket = command.input.Bucket ?? ''
    listed.push(bucket)
    if (bucket === failBucket) throw new Error('AccessDenied')
    return {
      Contents: [{ Size: bucket === 'denel-public' ? 100 : 250 }],
      IsTruncated: false,
    } as never
  })
})
afterEach(() => vi.restoreAllMocks())

const app = () => {
  const a = new Hono<HonoEnv>()
  a.route('/api/integrations', integrationsApp)
  return a
}

describe('R2 settings', () => {
  it('returns the saved private bucket', async () => {
    const body = (await (await app().request('/api/integrations/r2')).json()) as {
      data: { bucket: string; privateBucket: string }
    }

    expect(body.data).toMatchObject({ bucket: R2.bucket, privateBucket: R2.privateBucket })
  })

  it('tests both buckets with a list call', async () => {
    const res = await app().request('/api/integrations/r2/test', { method: 'POST' })
    const body = (await res.json()) as { data: unknown }

    expect(listed).toEqual(['denel-public', 'denel-private'])
    expect(body.data).toEqual({
      ok: true,
      buckets: [
        { role: 'public', bucket: 'denel-public', ok: true },
        { role: 'private', bucket: 'denel-private', ok: true },
      ],
    })
  })

  it('says which bucket failed', async () => {
    failBucket = 'denel-private'

    const body = (await (
      await app().request('/api/integrations/r2/test', { method: 'POST' })
    ).json()) as {
      data: { ok: boolean; error: string; buckets: Array<{ ok: boolean }> }
    }

    expect(body.data.ok).toBe(false)
    expect(body.data.error).toBe('denel-private: AccessDenied')
    expect(body.data.buckets.map((b) => b.ok)).toEqual([true, false])
  })

  it('refuses to save the same bucket as public and private', async () => {
    const res = await app().request('/api/integrations/r2', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bucket: 'denel-files', privateBucket: ' Denel-Files ' }),
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error:
        'The private bucket must be a different bucket from the public one — otherwise every private file would be public.',
    })
  })

  it('adds both buckets up in usage', async () => {
    const body = (await (await app().request('/api/integrations/r2/usage')).json()) as {
      data: { usedBytes: number; objectCount: number }
    }

    expect(body.data).toMatchObject({ usedBytes: 350, objectCount: 2 })
  })
})
