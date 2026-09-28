/**
 * Stamping a signature onto a document template reads the template's bytes —
 * straight from the private bucket for a reference, over HTTP for a plain link.
 */
import { type GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/config/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://localhost:5432/test',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
    PRIVATE_FILE_REF_SECRET: 'test-file-ref-secret-at-least-32-characters',
  },
}))
vi.mock('../../src/lib/integrations', () => ({
  getR2Config: vi.fn(async () => ({
    endpoint: 'https://0123456789abcdef.r2.cloudflarestorage.com',
    bucket: 'denel-public',
    privateBucket: 'denel-private',
    region: 'auto',
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'secretEXAMPLE',
    publicUrl: 'https://pub-test.r2.dev',
  })),
  getDoSpacesConfig: vi.fn(async () => null),
  getCloudinaryConfig: vi.fn(async () => null),
}))

import { makePrivateRef, readStoredFile } from '../../src/lib/private-files'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('readStoredFile', () => {
  it('reads a reference from the private bucket', async () => {
    const requests: unknown[] = []
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (command: unknown) => {
      requests.push((command as GetObjectCommand).input)
      return {
        Body: { transformToByteArray: async () => new Uint8Array([37, 80, 68, 70]) },
      } as never
    })

    const bytes = await readStoredFile(makePrivateRef('r2', 'templates/consent.pdf'))

    expect(Array.from(bytes)).toEqual([37, 80, 68, 70])
    expect(requests).toEqual([{ Bucket: 'denel-private', Key: 'templates/consent.pdf' }])
  })

  it('refuses a reference the server did not issue, without reading storage', async () => {
    const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never)
    const forged = makePrivateRef('r2', 'staff/other/contract.pdf').replace('other', 'victim')

    await expect(readStoredFile(forged)).rejects.toThrow(
      'This file reference was not issued by this server'
    )
    expect(send).not.toHaveBeenCalled()
  })

  it('downloads a plain link', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
    )

    expect(Array.from(await readStoredFile('https://pub-test.r2.dev/x.pdf'))).toEqual([1, 2, 3])
  })

  it('throws when a plain link does not answer 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 404 }))
    )

    await expect(readStoredFile('https://pub-test.r2.dev/x.pdf')).rejects.toThrow('HTTP 404')
  })
})
