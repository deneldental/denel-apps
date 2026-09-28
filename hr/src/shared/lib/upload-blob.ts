/**
 * Shared blob → object-storage upload helper.
 *
 * Wraps `uploadFile()` so callers (avatar croppers, signature pads, …) can take
 * a Blob produced in-browser and put it into R2 / DO Spaces / Cloudinary.
 * Returns the final public URL. Throws on failure.
 */

import { type StorageCategory, type UploadProfile, uploadFile } from '@/lib/actions/upload'

interface UploadBlobOptions {
  storageCategory: StorageCategory
  folder: string
  subfolder?: string
  extension?: string
  profile?: UploadProfile
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

/** Upload a Blob to the active storage provider and return the public URL. */
export async function uploadBlob(blob: Blob, options: UploadBlobOptions): Promise<string> {
  const ext = options.extension ?? extensionForMime(blob.type || 'application/octet-stream')
  const nameRoot = options.nameRoot ?? `${Date.now()}`
  const filename = `${nameRoot}.${ext}`

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
