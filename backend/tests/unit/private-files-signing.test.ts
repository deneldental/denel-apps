/**
 * Signed links for private files and the check that turns one of OUR signed
 * links back into its reference. Signing is local HMAC work — no network.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  r2: null as Record<string, unknown> | null,
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
  getDoSpacesConfig: vi.fn(async () => null),
  getCloudinaryConfig: vi.fn(async () => null),
}))

import {
  configuredPrivateTargets,
  createTargetCache,
  refFromSignedUrl,
  signPrivateRef,
} from '../../src/lib/private-files'
import { getPrivateTarget } from '../../src/lib/storage-providers'

const R2 = {
  endpoint: 'https://0123456789abcdef.r2.cloudflarestorage.com',
  bucket: 'denel-public',
  privateBucket: 'denel-private',
  region: 'auto',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'secretEXAMPLE',
  publicUrl: 'https://pub-test.r2.dev',
}
const TRICKY = { provider: 'r2' as const, key: "patients/p 1/Ama's x-ray (1) ü.jpg" }
const at = (iso: string) => new Date(iso)

afterEach(() => {
  state.r2 = null
})

describe('private targets', () => {
  it('uses the private bucket for R2', async () => {
    state.r2 = R2

    expect((await getPrivateTarget('r2')).bucket).toBe('denel-private')
  })

  it('refuses when the R2 private bucket is not configured', async () => {
    state.r2 = { ...R2, privateBucket: '' }

    await expect(getPrivateTarget('r2')).rejects.toThrow(
      'Cloudflare R2: the private bucket is not configured — Settings → Integrations → R2'
    )
  })

  it('refuses a private bucket that is the public bucket', async () => {
    state.r2 = { ...R2, privateBucket: 'Denel-Public' }

    await expect(getPrivateTarget('r2')).rejects.toThrow(
      'Cloudflare R2: the private bucket must be a different bucket from the public one'
    )
  })

  it('lists only the targets that are configured', async () => {
    state.r2 = R2

    expect((await configuredPrivateTargets()).map((t) => t.provider)).toEqual(['r2'])
  })
})

describe('signed links', () => {
  it('points at the private bucket, is a plain GET, and lives 75 minutes', async () => {
    state.r2 = R2

    const url = new URL(
      await signPrivateRef(TRICKY, at('2026-09-26T10:01:00Z'), createTargetCache())
    )

    expect(url.host).toBe('denel-private.0123456789abcdef.r2.cloudflarestorage.com')
    expect(url.searchParams.get('X-Amz-Expires')).toBe('4500')
    expect(url.searchParams.get('X-Amz-Date')).toBe('20260926T100000Z')
    expect(url.searchParams.has('x-amz-checksum-mode')).toBe(false)
  })

  it('is identical within a 15-minute window and changes in the next', async () => {
    state.r2 = R2
    const cache = createTargetCache()

    const a = await signPrivateRef(TRICKY, at('2026-09-26T10:01:00Z'), cache)
    const b = await signPrivateRef(TRICKY, at('2026-09-26T10:14:59Z'), cache)
    const c = await signPrivateRef(TRICKY, at('2026-09-26T10:15:00Z'), cache)

    expect(b).toBe(a)
    expect(c).not.toBe(a)
  })
})

describe('turning our signed links back into references', () => {
  it('recognises a genuine link, tricky key included', async () => {
    state.r2 = R2
    const url = await signPrivateRef(TRICKY, at('2026-09-26T10:01:00Z'), createTargetCache())

    expect(await refFromSignedUrl(url, await configuredPrivateTargets())).toEqual(TRICKY)
  })

  it('still recognises a genuine link long after it expired', async () => {
    state.r2 = R2
    const url = await signPrivateRef(TRICKY, at('2020-01-01T00:00:00Z'), createTargetCache())

    expect(await refFromSignedUrl(url, await configuredPrivateTargets())).toEqual(TRICKY)
  })

  it('rejects a link whose key or signature was altered', async () => {
    state.r2 = R2
    const url = await signPrivateRef(
      { provider: 'r2', key: 'patients/a/scan.jpg' },
      at('2026-09-26T10:01:00Z'),
      createTargetCache()
    )
    const targets = await configuredPrivateTargets()

    expect(await refFromSignedUrl(url.replace('scan.jpg', 'scam.jpg'), targets)).toBeNull()
    expect(
      await refFromSignedUrl(url.replace(/X-Amz-Signature=[0-9a-f]/, 'X-Amz-Signature=0'), targets)
    ).toBeNull()
  })

  it('rejects a link signed with other credentials', async () => {
    state.r2 = { ...R2, accessKeyId: 'OTHERKEY', secretAccessKey: 'otherSecret' }
    const foreign = await signPrivateRef(TRICKY, at('2026-09-26T10:01:00Z'), createTargetCache())
    state.r2 = R2

    expect(await refFromSignedUrl(foreign, await configuredPrivateTargets())).toBeNull()
  })

  it('ignores links to other hosts', async () => {
    state.r2 = R2

    expect(
      await refFromSignedUrl(
        'https://example.com/a.jpg?X-Amz-Date=20260926T100000Z&X-Amz-Expires=4500&X-Amz-Signature=abc',
        await configuredPrivateTargets()
      )
    ).toBeNull()
  })

  it('treats an out-of-range expiry as not ours instead of failing', async () => {
    state.r2 = R2
    const url = await signPrivateRef(TRICKY, at('2026-09-26T10:01:00Z'), createTargetCache())

    expect(
      await refFromSignedUrl(
        url.replace('X-Amz-Expires=4500', 'X-Amz-Expires=99999999'),
        await configuredPrivateTargets()
      )
    ).toBeNull()
  })
})
