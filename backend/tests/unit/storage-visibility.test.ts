/**
 * Where an upload lands. Private is the default; only callers that ask for
 * 'public' get a permanent public link. The S3 client is faked at `send`.
 */
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  r2: null as Record<string, unknown> | null,
  doSpaces: null as Record<string, unknown> | null,
  routing: null as Record<string, string> | null,
}))

vi.mock('../../src/config/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://localhost:5432/test',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
    PRIVATE_FILE_REF_SECRET: 'test-file-ref-secret-at-least-32-characters',
  },
}))
vi.mock('../../src/lib/integrations', () => ({
  getR2Config: vi.fn(async () => state.r2),
  getDoSpacesConfig: vi.fn(async () => state.doSpaces),
  getCloudinaryConfig: vi.fn(async () => ({
    cloudName: 'c',
    apiKey: 'k',
    apiSecret: 's',
    uploadFolder: '',
    enabled: true,
  })),
  getStorageRouting: vi.fn(async () => state.routing),
}))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { backupObjectKey } from '../../src/lib/backup-scheduler'
import { parsePrivateRef } from '../../src/lib/private-files'
import {
  deleteFromCategory,
  getSignedDownloadUrlForCategory,
  uploadPrivateToProvider,
  uploadToCategory,
} from '../../src/lib/storage-router'

const R2 = {
  endpoint: 'https://0123456789abcdef.r2.cloudflarestorage.com',
  bucket: 'denel-public',
  privateBucket: 'denel-private',
  region: 'auto',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'secretEXAMPLE',
  publicUrl: 'https://pub-test.r2.dev',
}
const DO = {
  endpoint: 'https://fra1.digitaloceanspaces.com',
  bucket: 'denel-space',
  region: 'fra1',
  accessKeyId: 'DOKEY',
  secretAccessKey: 'doSecret',
  publicUrl: 'https://denel-space.fra1.cdn.digitaloceanspaces.com',
}

let sent: unknown[]
beforeEach(() => {
  sent = []
  state.r2 = R2
  vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (command: unknown) => {
    sent.push(command)
    return {} as never
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  state.doSpaces = null
  state.routing = null
})

const puts = () =>
  sent.filter((c): c is PutObjectCommand => c instanceof PutObjectCommand).map((c) => c.input)

describe('uploadToCategory', () => {
  it('stores in the R2 private bucket by default and returns a reference', async () => {
    const { url } = await uploadToCategory(
      'patient_records',
      'xrays/a.jpg',
      Buffer.from('x'),
      'image/jpeg'
    )

    expect(puts()).toEqual([
      expect.objectContaining({
        Bucket: 'denel-private',
        Key: 'xrays/a.jpg',
        ContentType: 'image/jpeg',
      }),
    ])
    expect(puts()[0]).not.toHaveProperty('ACL')
    expect(parsePrivateRef(url)).toEqual({ provider: 'r2', key: 'xrays/a.jpg' })
  })

  it("stores 'public' uploads in the R2 public bucket and returns the public link", async () => {
    const { url } = await uploadToCategory(
      'system_docs',
      'SYS/branding/logo.png',
      Buffer.from('x'),
      'image/png',
      'public'
    )

    expect(puts()[0]).toEqual(expect.objectContaining({ Bucket: 'denel-public' }))
    expect(url).toBe('https://pub-test.r2.dev/SYS/branding/logo.png')
  })

  it('uses per-object ACLs on DigitalOcean Spaces', async () => {
    state.doSpaces = DO
    state.routing = {
      patient_records: 'do_spaces',
      staff: 'do_spaces',
      system_docs: 'do_spaces',
      misc: 'do_spaces',
    }

    const priv = await uploadToCategory(
      'patient_records',
      'a.pdf',
      Buffer.from('x'),
      'application/pdf'
    )
    await uploadToCategory(
      'system_docs',
      'SYS/branding/logo.png',
      Buffer.from('x'),
      'image/png',
      'public'
    )

    expect(puts().map((p) => [p.Bucket, p.ACL])).toEqual([
      ['denel-space', 'private'],
      ['denel-space', 'public-read'],
    ])
    expect(parsePrivateRef(priv.url)).toEqual({ provider: 'do_spaces', key: 'a.pdf' })
  })

  it('refuses a private upload routed to Cloudinary, without uploading', async () => {
    state.routing = { patient_records: 'cloudinary', staff: 'r2', system_docs: 'r2', misc: 'r2' }

    await expect(
      uploadToCategory('patient_records', 'a.jpg', Buffer.from('x'), 'image/jpeg')
    ).rejects.toThrow(
      `Cloudinary can't store private files — in Settings → Integrations → Storage routing, send the "patient_records" category to Cloudflare R2 or DigitalOcean Spaces.`
    )
    expect(sent).toHaveLength(0)
  })

  it('fails clearly when the R2 private bucket is missing', async () => {
    state.r2 = { ...R2, privateBucket: '' }

    await expect(
      uploadToCategory('staff', 'cv.pdf', Buffer.from('x'), 'application/pdf')
    ).rejects.toThrow('the private bucket is not configured')
  })
})

describe('uploadPrivateToProvider (the backup path)', () => {
  it('uploads straight to the chosen provider, privately, ignoring routing', async () => {
    state.doSpaces = DO
    // Routing points everything elsewhere — the explicit choice must win.
    state.routing = { patient_records: 'r2', staff: 'r2', system_docs: 'cloudinary', misc: 'r2' }

    const viaR2 = await uploadPrivateToProvider(
      'r2',
      'SYS/backups/a.gz',
      Buffer.from('x'),
      'application/gzip'
    )
    const viaDo = await uploadPrivateToProvider(
      'do_spaces',
      'SYS/backups/a.gz',
      Buffer.from('x'),
      'application/gzip'
    )

    expect(puts().map((p) => [p.Bucket, p.ACL])).toEqual([
      ['denel-private', undefined],
      ['denel-space', 'private'],
    ])
    expect(parsePrivateRef(viaR2.url)?.provider).toBe('r2')
    expect(parsePrivateRef(viaDo.url)?.provider).toBe('do_spaces')
  })
})

describe('statements: signed download and delete use the private bucket', () => {
  it('signs a download from the private bucket', async () => {
    const url = new URL(
      await getSignedDownloadUrlForCategory('patient_records', 'statements/s.pdf')
    )

    expect(url.host).toBe('denel-private.0123456789abcdef.r2.cloudflarestorage.com')
  })

  it('deletes from the private bucket', async () => {
    await deleteFromCategory('patient_records', 'statements/s.pdf')

    const deletes = sent.filter((c): c is DeleteObjectCommand => c instanceof DeleteObjectCommand)
    expect(deletes.map((d) => d.input)).toEqual([
      { Bucket: 'denel-private', Key: 'statements/s.pdf' },
    ])
  })
})

describe('backup object keys', () => {
  it('add an unguessable part to the timestamp', () => {
    const a = backupObjectKey('daily-6pm', '2026-09-26T18-00-00-000Z')
    const b = backupObjectKey('daily-6pm', '2026-09-26T18-00-00-000Z')

    expect(a).toMatch(/^SYS\/backups\/daily-6pm\/2026-09-26T18-00-00-000Z-[0-9a-f]{16}\.sql\.gz$/)
    expect(b).not.toBe(a)
  })
})
