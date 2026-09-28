/**
 * Shared blob → object-storage upload helper.
 *
 * Wraps `uploadFile()` so callers anywhere in the portal (avatar croppers,
 * signature pads, audio uploads, case-image attachments) can take a Blob
 * produced in-browser and put it into R2 / DO Spaces / Cloudinary without
 * touching base64 ever again.
 *
 * Returns the final public URL. Throws on failure so callers don't silently
 * fall back to data URLs and re-introduce DB bloat.
 */

import { type StorageCategory, type UploadProfile, uploadFile } from '@/lib/actions/upload'

interface UploadBlobOptions {
  /** Storage routing bucket — picked by admin in Integrations. */
  storageCategory: StorageCategory
  /** Top-level folder within the bucket, e.g. "staff", "patients", "system". */
  folder: string
  /** Optional nested path, e.g. "{id}/avatar". */
  subfolder?: string
  /** File extension WITHOUT a leading dot. Defaults to inferring from the blob's MIME. */
  extension?: string
  /** Validation profile. Defaults to "image". */
  profile?: UploadProfile
  /** Filename root before the extension. Defaults to a timestamp. */
  nameRoot?: string
}

function extensionForMime(mime: string): string {
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/gif') return 'gif'
  if (mime === 'audio/mpeg') return 'mp3'
  if (mime === 'audio/wav' || mime === 'audio/x-wav') return 'wav'
  if (mime === 'audio/ogg') return 'ogg'
  return 'bin'
}

/**
 * Upload a Blob to the active storage provider and return the public URL.
 * Throws if upload fails — callers must handle the rejection.
 */
export async function uploadBlob(blob: Blob, options: UploadBlobOptions): Promise<string> {
  const ext = options.extension ?? extensionForMime(blob.type || 'application/octet-stream')
  const nameRoot = options.nameRoot ?? `${Date.now()}`
  const filename = `${nameRoot}.${ext}`

  // Backend reads `file.name` for extension/key generation, so wrap the blob
  // in a File with a stable name. A bare Blob would arrive as "blob".
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' })

  const result = await uploadFile(file, {
    storageCategory: options.storageCategory,
    folder: options.folder,
    subfolder: options.subfolder,
    name: options.nameRoot,
    profile: options.profile ?? 'image',
  })

  if (!result.success || !result.url) {
    throw new Error(result.error || 'Upload failed')
  }
  return result.url
}

// ── Convenience wrappers ──────────────────────────────────────────────────────
// Each wrapper encodes a single subsystem's storage convention so callers
// don't have to remember the right folder/subfolder for that resource.

/** Staff/specialist avatars. `id` may be `"new"` during create flow. */
export function uploadAvatar(
  blob: Blob,
  opts: { kind: 'staff' | 'specialist'; id: string }
): Promise<string> {
  return uploadBlob(blob, {
    storageCategory: 'staff',
    folder: opts.kind === 'staff' ? 'Staff' : 'Specialists',
    subfolder: `${opts.id}/avatar`,
    extension: 'jpg',
    profile: 'image',
  })
}

/** Clinical case images (examination findings, ortho-review photos). */
export function uploadCaseImage(blob: Blob, opts: { patientId: string }): Promise<string> {
  return uploadBlob(blob, {
    storageCategory: 'patient_records',
    folder: 'Patients',
    subfolder: `${opts.patientId}/case-images`,
    extension: 'jpg',
    profile: 'image',
  })
}

/** Patient-facing signatures (consent forms, treatment-plan approvals). */
export function uploadSignature(
  blob: Blob,
  opts: { kind: 'consent' | 'treatment-plan'; patientId: string }
): Promise<string> {
  return uploadBlob(blob, {
    storageCategory: 'patient_records',
    folder: 'Patients',
    subfolder: `${opts.patientId}/signatures/${opts.kind}`,
    extension: 'png',
    profile: 'image',
  })
}

/**
 * Convert a base64 data URL (e.g. from `canvas.toDataURL()`) into a Blob.
 * Useful for taking signature-pad output and uploading it without round-tripping
 * through the DOM.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(',', 2)
  const mimeMatch = meta?.match(/data:([^;]+);base64/)
  const mime = mimeMatch?.[1] ?? 'application/octet-stream'
  const binary = atob(b64 ?? '')
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/**
 * If `value` is already a URL (https://...), pass it through. If it's a data
 * URL, convert to blob and upload via the given uploader. Returns the final URL
 * in either case.
 *
 * Used by submit handlers that may receive either an unchanged signature URL
 * (no edit) or a freshly captured data URL (user re-signed).
 */
export async function ensureUploaded(
  value: string | null | undefined,
  uploader: (blob: Blob) => Promise<string>
): Promise<string | null> {
  if (!value) return null
  if (!value.startsWith('data:')) return value
  const blob = dataUrlToBlob(value)
  return uploader(blob)
}

/** Clinic-wide audio assets (custom appointment alert sound). */
export function uploadAudio(file: File): Promise<string> {
  return uploadBlob(file, {
    storageCategory: 'system_docs',
    folder: 'System',
    subfolder: 'audio',
    profile: 'audio',
    nameRoot: `${Date.now()}-${file.name.replace(/\.[^.]+$/, '').replace(/\s+/g, '-')}`,
    extension: extensionForMime(file.type) || file.name.split('.').pop() || 'mp3',
  })
}
