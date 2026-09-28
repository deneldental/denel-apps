// Category-aware upload helper. Reads the storage routing config to pick which
// provider handles each file category, dispatches to the registry adapter, and
// returns the public URL.
//
// Single seam between "what kind of file is this" and "where does it go." Every
// upload site in the backend should call this — provider quirks (endpoints,
// virtual-hosted addressing, Cloudinary's separate SDK) live in
// `storage-providers.ts`, not here.

import type { Readable } from 'node:stream'
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getStorageRouting, type StorageProviderId, type StorageRouting } from './integrations'
import { makePrivateRef } from './private-files'
import {
  buildS3CompatRuntime,
  getPrivateTarget,
  getProvider,
  type PrivateProvider,
  type ProviderAdapter,
  uploadViaCloudinary,
} from './storage-providers'

export type FileCategory = keyof StorageRouting
export type Visibility = 'public' | 'private'

/** Resolve the active provider id for a given category. Defaults to `r2`. */
export async function getActiveProviderId(category: FileCategory): Promise<StorageProviderId> {
  const routing = await getStorageRouting()
  return (routing?.[category] ?? 'r2') as StorageProviderId
}

async function getActiveAdapter(category: FileCategory): Promise<ProviderAdapter> {
  const id = await getActiveProviderId(category)
  return getProvider(id)
}

/**
 * Upload a file to whichever provider is configured for the category.
 *
 * Private by default: the file goes to the provider's private target and the
 * returned `url` is a private reference (lib/private-files.ts) that callers
 * store as they stored links before — the API edge turns it into a short-lived
 * link for screens. Only `'public'` uploads (branding) get a permanent link.
 */
export async function uploadToCategory(
  category: FileCategory,
  key: string,
  body: Buffer | Uint8Array | Readable,
  contentType: string,
  visibility: Visibility = 'private'
): Promise<{ url: string; providerId: StorageProviderId }> {
  const adapter = await getActiveAdapter(category)

  if (adapter.kind === 'cloudinary') {
    if (visibility === 'private') {
      throw new Error(
        `Cloudinary can't store private files — in Settings → Integrations → Storage routing, send the "${category}" category to Cloudflare R2 or DigitalOcean Spaces.`
      )
    }
    const url = await uploadViaCloudinary(adapter, key, body, contentType)
    return { url, providerId: adapter.id }
  }

  if (visibility === 'public') {
    const { client, bucket, publicUrlBase } = await buildS3CompatRuntime(adapter)
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ...(adapter.supportsObjectAcl ? { ACL: 'public-read' as const } : {}),
      })
    )
    return { url: `${publicUrlBase}/${key}`, providerId: adapter.id }
  }

  return uploadPrivateToProvider(adapter.id, key, body, contentType)
}

/**
 * Upload straight to a named provider's private target, bypassing category
 * routing — for the database backup, whose destination is the Backup card's
 * own "Storage target" choice, not the file-category routing table.
 */
export async function uploadPrivateToProvider(
  providerId: PrivateProvider,
  key: string,
  body: Buffer | Uint8Array | Readable,
  contentType: string
): Promise<{ url: string; providerId: StorageProviderId }> {
  const adapter = getProvider(providerId)
  if (adapter.kind !== 's3-compat') {
    throw new Error(`${adapter.label} cannot store private files`)
  }
  const target = await getPrivateTarget(providerId)
  await target.client.send(
    new PutObjectCommand({
      Bucket: target.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ...(adapter.supportsObjectAcl ? { ACL: 'private' as const } : {}),
    })
  )
  return { url: makePrivateRef(providerId, key), providerId }
}

/**
 * Best-effort delete of a PRIVATE object (the only caller, patient statements,
 * stores private files). Cloudinary deletes are not supported here.
 *
 * Caveat: if routing changed since the upload, the active provider won't have
 * the object.
 */
export async function deleteFromCategory(category: FileCategory, key: string): Promise<void> {
  const adapter = await getActiveAdapter(category)
  if (adapter.kind === 'cloudinary') return
  const target = await getPrivateTarget(adapter.id)
  await target.client.send(new DeleteObjectCommand({ Bucket: target.bucket, Key: key }))
}

/**
 * Return the public URL that an upload to this category + key would produce,
 * without doing the upload. Useful for derivable URLs (e.g. signed-URL or
 * direct-upload flows). Throws if the provider isn't configured.
 */
export async function getPublicUrlForCategory(
  category: FileCategory,
  key: string
): Promise<string> {
  const adapter = await getActiveAdapter(category)
  if (adapter.kind === 'cloudinary') {
    // Cloudinary URLs aren't deterministic from key alone (they encode
    // resource_type, version, etc.). Callers should obtain the URL from the
    // upload response and persist it; this helper is S3-compat only.
    throw new Error('Cloudinary public URLs cannot be pre-computed from a key')
  }
  const { publicUrlBase } = await buildS3CompatRuntime(adapter)
  return `${publicUrlBase}/${key}`
}

/**
 * Presigned, time-limited GET URL for a PRIVATE object (patient statements).
 * The signature authorizes a single object read for `expiresIn` seconds; after
 * that the link is dead. Optionally forces a download with a friendly filename
 * via Content-Disposition.
 *
 * S3-compatible providers only.
 */
export async function getSignedDownloadUrlForCategory(
  category: FileCategory,
  key: string,
  opts: { expiresIn?: number; downloadFilename?: string } = {}
): Promise<string> {
  const adapter = await getActiveAdapter(category)
  if (adapter.kind === 'cloudinary') {
    throw new Error('Cloudinary objects cannot be presigned from a key')
  }
  const { client, bucket } = await getPrivateTarget(adapter.id)
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ...(opts.downloadFilename
      ? { ResponseContentDisposition: `attachment; filename="${opts.downloadFilename}"` }
      : {}),
  })
  // The presigner and client-s3 resolve slightly different AWS SDK type copies,
  // so their Client<…>/Command<…> generics don't line up at compile time even
  // though `getSignedUrl(s3Client, getObjectCommand)` is the documented runtime
  // usage. Suppress the typings-only mismatch at this single seam.
  // biome-ignore lint/suspicious/noExplicitAny: AWS SDK presigner typings mismatch
  return getSignedUrl(client as any, command as any, { expiresIn: opts.expiresIn ?? 300 })
}
