// Storage provider registry. The single seam between "which provider handles
// this file" and "how do we talk to that provider." Adding a new S3-compatible
// provider (AWS S3, Wasabi, B2) is one entry below; no upload-site changes.
//
// Provider quirks live here, never in callers:
//   - DO Spaces strips the bucket subdomain from the endpoint to avoid the
//     virtual-hosted-style double-prefix that breaks TLS against the
//     `*.fra1.digitaloceanspaces.com` wildcard cert.
//   - R2 typically routes through a custom CDN domain set as `publicUrl`.

import type { Readable } from 'node:stream'
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import { v2 as cloudinary } from 'cloudinary'
import {
  type CloudinaryConfig,
  type DoSpacesConfig,
  getCloudinaryConfig,
  getDoSpacesConfig,
  getR2Config,
  type R2Config,
  type StorageProviderId,
} from './integrations'

// ── Adapter shapes ──────────────────────────────────────────────────────────

export type S3CompatConfig = R2Config | DoSpacesConfig

export type S3CompatAdapter = {
  id: 'r2' | 'do_spaces'
  label: string
  kind: 's3-compat'
  loadConfig: () => Promise<S3CompatConfig | null>
  /** Strip per-provider host quirks (e.g. DO bucket-prefixed endpoint). */
  normalizeEndpoint: (rawEndpoint: string, bucket: string) => string
  /**
   * Whether `<endpoint>/<bucket>/<key>` is readable by an anonymous browser.
   *
   * True for DO Spaces (the Spaces endpoint doubles as the CDN origin), FALSE
   * for R2 — its S3 API endpoint (`<account>.r2.cloudflarestorage.com`) only
   * answers signed requests. When false, `publicUrl` MUST be configured or every
   * upload would be handed back a dead link.
   */
  endpointIsPubliclyReadable: boolean
  /**
   * Whether objects carry their own ACL. DO Spaces: yes — public and private
   * files share one bucket. R2: no — private files need their own bucket.
   */
  supportsObjectAcl: boolean
}

export type CloudinaryAdapter = {
  id: 'cloudinary'
  label: string
  kind: 'cloudinary'
  loadConfig: () => Promise<CloudinaryConfig | null>
}

export type ProviderAdapter = S3CompatAdapter | CloudinaryAdapter

// ── Endpoint normalizers ────────────────────────────────────────────────────

const identityNormalize = (endpoint: string, _bucket: string) => endpoint

/**
 * DO Spaces: the wildcard cert is single-level (`*.fra1.digitaloceanspaces.com`).
 * If the admin pasted a bucket-prefixed endpoint, the SDK's virtual-hosted
 * addressing would double the bucket subdomain and fail TLS. Strip it.
 */
function doSpacesNormalize(rawEndpoint: string, bucket: string): string {
  try {
    const url = new URL(rawEndpoint)
    if (bucket && url.hostname.toLowerCase().startsWith(`${bucket.toLowerCase()}.`)) {
      url.hostname = url.hostname.slice(bucket.length + 1)
    }
    return url.origin
  } catch {
    return rawEndpoint
  }
}

// ── Registry ────────────────────────────────────────────────────────────────

export const STORAGE_PROVIDERS: Record<StorageProviderId, ProviderAdapter> = {
  r2: {
    id: 'r2',
    label: 'Cloudflare R2',
    kind: 's3-compat',
    loadConfig: getR2Config,
    normalizeEndpoint: identityNormalize,
    // R2's S3 endpoint serves signed requests only — a public URL is required.
    endpointIsPubliclyReadable: false,
    supportsObjectAcl: false,
  },
  do_spaces: {
    id: 'do_spaces',
    label: 'DigitalOcean Spaces',
    kind: 's3-compat',
    loadConfig: getDoSpacesConfig,
    normalizeEndpoint: doSpacesNormalize,
    endpointIsPubliclyReadable: true,
    supportsObjectAcl: true,
  },
  cloudinary: {
    id: 'cloudinary',
    label: 'Cloudinary',
    kind: 'cloudinary',
    loadConfig: getCloudinaryConfig,
  },
}

export function getProvider(id: StorageProviderId): ProviderAdapter {
  const provider = STORAGE_PROVIDERS[id]
  if (!provider) {
    throw new Error(`Unknown storage provider: ${id}`)
  }
  return provider
}

export function listProviders(): ProviderAdapter[] {
  return Object.values(STORAGE_PROVIDERS)
}

// ── S3-compat client builder ────────────────────────────────────────────────

/**
 * Optional checksums off. The AWS SDK (≥ 3.729) adds CRC32 headers to uploads
 * and `x-amz-checksum-mode=ENABLED` to every presigned GET by default; R2's S3
 * API documents neither, and a download link must stay a plain GET.
 */
function makeS3Client(endpoint: string, region: string, cfg: S3CompatConfig): S3Client {
  return new S3Client({
    region,
    endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })
}

/** Bucket names compare case-insensitively, ignoring stray spaces. */
export function sameBucket(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()
}

export type PrivateProvider = S3CompatAdapter['id']
export type PrivateTarget = { provider: PrivateProvider; client: S3Client; bucket: string }

/**
 * Where private files live for a provider: R2's separate private bucket (R2 has
 * no per-object ACL), or the DO Spaces bucket itself (objects are private by ACL).
 */
export async function getPrivateTarget(provider: PrivateProvider): Promise<PrivateTarget> {
  const adapter = getProvider(provider)
  if (adapter.kind !== 's3-compat') throw new Error(`${adapter.label} cannot store private files`)
  const cfg = await adapter.loadConfig()
  if (!cfg?.endpoint || !cfg.accessKeyId || !cfg.secretAccessKey) {
    throw new Error(`${adapter.label} is not configured`)
  }
  const bucket = adapter.supportsObjectAcl
    ? cfg.bucket
    : 'privateBucket' in cfg
      ? cfg.privateBucket
      : undefined
  if (!bucket) {
    throw new Error(
      adapter.supportsObjectAcl
        ? `${adapter.label} is not configured`
        : `${adapter.label}: the private bucket is not configured — Settings → Integrations → R2`
    )
  }
  if (!adapter.supportsObjectAcl && sameBucket(bucket, cfg.bucket)) {
    // The public bucket is readable through its public URL: private files there
    // would be public again.
    throw new Error(
      `${adapter.label}: the private bucket must be a different bucket from the public one`
    )
  }
  const endpoint = adapter.normalizeEndpoint(cfg.endpoint, bucket)
  return { provider, client: makeS3Client(endpoint, cfg.region || 'auto', cfg), bucket }
}

export type S3CompatRuntime = {
  client: S3Client
  bucket: string
  publicUrlBase: string
}

export async function buildS3CompatRuntime(adapter: S3CompatAdapter): Promise<S3CompatRuntime> {
  const cfg = await adapter.loadConfig()
  if (!cfg?.endpoint || !cfg.bucket || !cfg.accessKeyId || !cfg.secretAccessKey) {
    throw new Error(`${adapter.label} is not configured`)
  }
  const endpoint = adapter.normalizeEndpoint(cfg.endpoint, cfg.bucket)
  const region = cfg.region || 'auto'
  const publicUrl = cfg.publicUrl?.replace(/\/+$/, '')

  // Fail loudly rather than handing back `<private-endpoint>/<bucket>/<key>`.
  // That fallback is only valid for providers whose endpoint is itself public
  // (DO Spaces). For R2 it silently produced dead links that then got persisted
  // forever into memo/training HTML — the upload "succeeded" and the image 404'd.
  if (!publicUrl && !adapter.endpointIsPubliclyReadable) {
    throw new Error(
      `${adapter.label}: "Public URL" is not configured. ${adapter.label}'s S3 endpoint is not publicly readable, so uploaded files would be saved with links that never load. Set the bucket's public URL (R2 public dev URL, e.g. https://pub-xxxx.r2.dev, or a custom domain) under Settings → Integrations → ${adapter.label}.`
    )
  }

  return {
    client: makeS3Client(endpoint, region, cfg),
    bucket: cfg.bucket,
    publicUrlBase: publicUrl || `${endpoint}/${cfg.bucket}`,
  }
}

// ── Cloudinary upload helper ────────────────────────────────────────────────

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export async function uploadViaCloudinary(
  adapter: CloudinaryAdapter,
  key: string,
  body: Buffer | Uint8Array | Readable,
  _contentType: string
): Promise<string> {
  const cfg = await adapter.loadConfig()
  if (!cfg?.cloudName || !cfg.apiKey || !cfg.apiSecret) {
    throw new Error(`${adapter.label} is not configured`)
  }
  cloudinary.config({
    cloud_name: cfg.cloudName,
    api_key: cfg.apiKey,
    api_secret: cfg.apiSecret,
    secure: true,
  })

  // Map our object key (e.g. `SYS/branding/logo.png`) to Cloudinary's model:
  // keep the directory structure as the public_id, drop the extension.
  const dotIndex = key.lastIndexOf('.')
  const publicIdRaw = dotIndex > 0 ? key.slice(0, dotIndex) : key
  const folderPrefix = cfg.uploadFolder?.replace(/\/+$/, '') ?? ''
  const publicId = folderPrefix ? `${folderPrefix}/${publicIdRaw}` : publicIdRaw

  const buffer = Buffer.isBuffer(body)
    ? body
    : body instanceof Uint8Array
      ? Buffer.from(body)
      : await streamToBuffer(body)

  const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: publicId,
        resource_type: 'auto',
        overwrite: true,
        format: dotIndex > 0 ? key.slice(dotIndex + 1) : undefined,
      },
      (err, res) => {
        if (err || !res) return reject(err ?? new Error('Cloudinary upload returned no result'))
        resolve(res as { secure_url: string })
      }
    )
    stream.end(buffer)
  })

  return result.secure_url
}

// ── Usage queries ───────────────────────────────────────────────────────────

export type ProviderUsage = {
  /** Bytes of storage in use. */
  usedBytes: number
  /** Plan limit in bytes. Null when no limit is known/configured. */
  quotaBytes: number | null
  /** Object/asset count. */
  objectCount: number
  /** True when we hit the listing cap before scanning the whole bucket. */
  partial: boolean
  /** Optional human-readable hint shown in the UI (e.g. "scanned 10K of N objects"). */
  note?: string
}

/** Cap how many objects we'll list per usage query. Above this, mark as partial. */
const MAX_LIST_OBJECTS = 10_000
const PAGE_SIZE = 1000

async function s3CompatUsage(
  adapter: S3CompatAdapter,
  cfg: S3CompatConfig
): Promise<ProviderUsage> {
  const runtime = await buildS3CompatRuntime(adapter)
  const stores = [{ client: runtime.client, bucket: runtime.bucket }]
  if (!adapter.supportsObjectAcl) {
    // R2 keeps private files in a second bucket; count it once it exists.
    const target = await getPrivateTarget(adapter.id).catch(() => null)
    if (target) stores.push({ client: target.client, bucket: target.bucket })
  }

  let usedBytes = 0
  let objectCount = 0
  let partial = false
  for (const store of stores) {
    let continuationToken: string | undefined
    do {
      const res = await store.client.send(
        new ListObjectsV2Command({
          Bucket: store.bucket,
          MaxKeys: PAGE_SIZE,
          ContinuationToken: continuationToken,
        })
      )
      for (const obj of res.Contents ?? []) {
        usedBytes += Number(obj.Size ?? 0)
        objectCount += 1
      }
      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined
      if (objectCount >= MAX_LIST_OBJECTS && continuationToken) {
        partial = true
        break
      }
    } while (continuationToken)
    if (partial) break
  }

  const quotaBytes = cfg.quotaGB && cfg.quotaGB > 0 ? Math.round(cfg.quotaGB * 1024 ** 3) : null

  return {
    usedBytes,
    quotaBytes,
    objectCount,
    partial,
    note: partial ? `scanned first ${MAX_LIST_OBJECTS.toLocaleString()} objects` : undefined,
  }
}

async function cloudinaryUsage(adapter: CloudinaryAdapter): Promise<ProviderUsage> {
  const cfg = await adapter.loadConfig()
  if (!cfg?.cloudName || !cfg.apiKey || !cfg.apiSecret) {
    throw new Error(`${adapter.label} is not configured`)
  }
  cloudinary.config({
    cloud_name: cfg.cloudName,
    api_key: cfg.apiKey,
    api_secret: cfg.apiSecret,
    secure: true,
  })
  // The /usage endpoint returns plan-level totals. Storage is reported in
  // bytes under `storage.usage`; the limit (if any) is at `storage.limit`.
  const res = (await cloudinary.api.usage()) as {
    storage?: { usage?: number; limit?: number; used_percent?: number }
    resources?: number
  }
  const usedBytes = Number(res.storage?.usage ?? 0)
  const limit = res.storage?.limit
  const quotaBytes = limit && Number.isFinite(limit) && limit > 0 ? Number(limit) : null
  return {
    usedBytes,
    quotaBytes,
    objectCount: Number(res.resources ?? 0),
    partial: false,
  }
}

/**
 * Return current storage usage for a provider. Throws if the provider isn't
 * configured. For S3-compatible providers, a `quotaGB` config field (admin-set)
 * supplies the total since DO Spaces / R2 don't expose plan limits over S3.
 */
export async function getProviderUsage(providerId: StorageProviderId): Promise<ProviderUsage> {
  const adapter = getProvider(providerId)
  if (adapter.kind === 'cloudinary') {
    return cloudinaryUsage(adapter)
  }
  const cfg = await adapter.loadConfig()
  if (!cfg?.endpoint || !cfg.bucket || !cfg.accessKeyId || !cfg.secretAccessKey) {
    throw new Error(`${adapter.label} is not configured`)
  }
  return s3CompatUsage(adapter, cfg)
}
