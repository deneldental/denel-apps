/**
 * Upload validation helpers — H3.3
 *
 * Enforces MIME whitelist, size limits, and magic-byte verification
 * so we don't trust the client's Content-Type header blindly.
 *
 * Usage:
 *   const profile = uploadProfiles.image
 *   const result = await validateUpload(file, profile)
 *   if (!result.ok) return c.json({ error: result.error }, 400)
 */

export type UploadProfile = {
  name: string
  /** MIME types accepted (exact match, no wildcards here — simpler to audit). */
  allowedMime: string[]
  /** File extensions accepted (lowercase, no leading dot). */
  allowedExt: string[]
  /** Max file size in bytes. */
  maxBytes: number
}

/** Magic-byte signatures for common formats. First N bytes must match. */
const MAGIC: Record<string, Uint8Array[]> = {
  'image/jpeg': [new Uint8Array([0xff, 0xd8, 0xff])],
  'image/png': [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  'image/webp': [
    // RIFF....WEBP — bytes 0-3 = "RIFF", bytes 8-11 = "WEBP"
    // We verify 0-3 here; 8-11 checked separately if needed
    new Uint8Array([0x52, 0x49, 0x46, 0x46]),
  ],
  'image/gif': [
    new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]), // GIF87a
    new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), // GIF89a
  ],
  'application/pdf': [new Uint8Array([0x25, 0x50, 0x44, 0x46])], // %PDF
}

/**
 * The type each extension names, for the formats checked by content. A file whose extension says one
 * thing and whose declared type says another is refused, and a file that declares no type at all is
 * held to the type its extension names — leaving the header out must not switch the content check off.
 */
const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
  svg: 'image/svg+xml',
}

/** Well-known upload profiles used across the app. */
export const uploadProfiles = {
  // Patient photos (intraoral, portrait, before/after), X-rays, staff docs
  image: {
    name: 'image',
    allowedMime: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    allowedExt: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
    maxBytes: 15 * 1024 * 1024, // 15 MB
  } satisfies UploadProfile,

  // PDF-only uploads (insurance pricing, consent forms, credential docs, expense receipts)
  pdf: {
    name: 'pdf',
    allowedMime: ['application/pdf'],
    allowedExt: ['pdf'],
    maxBytes: 25 * 1024 * 1024, // 25 MB
  } satisfies UploadProfile,

  // Mixed — images or PDFs (documents tab, expense receipts)
  imageOrPdf: {
    name: 'imageOrPdf',
    allowedMime: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    allowedExt: ['jpg', 'jpeg', 'png', 'webp', 'pdf'],
    maxBytes: 25 * 1024 * 1024,
  } satisfies UploadProfile,

  // CSV imports (bulk operations)
  csv: {
    name: 'csv',
    allowedMime: ['text/csv', 'application/vnd.ms-excel', 'application/csv'],
    allowedExt: ['csv'],
    maxBytes: 5 * 1024 * 1024, // 5 MB
  } satisfies UploadProfile,

  // Clinic logo uploads — icon and horizontal (SVG/PNG/WebP, no JPEG)
  logo: {
    name: 'logo',
    allowedMime: ['image/png', 'image/webp', 'image/svg+xml'],
    allowedExt: ['png', 'webp', 'svg'],
    maxBytes: 2 * 1024 * 1024, // 2 MB
  } satisfies UploadProfile,

  // Training-section videos embedded inside the rich content blocks. Bigger
  // than images because a 2-minute SOP clip easily hits 30-50 MB.
  video: {
    name: 'video',
    allowedMime: ['video/mp4', 'video/webm', 'video/quicktime'],
    allowedExt: ['mp4', 'webm', 'mov'],
    maxBytes: 100 * 1024 * 1024, // 100 MB
  } satisfies UploadProfile,

  // Short audio assets — custom appointment alert sounds. Small enough to live
  // in the same bucket as other system docs; no magic-byte enforcement (audio
  // formats use varied container headers).
  audio: {
    name: 'audio',
    allowedMime: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm'],
    allowedExt: ['mp3', 'wav', 'ogg', 'weba'],
    maxBytes: 5 * 1024 * 1024, // 5 MB
  } satisfies UploadProfile,
}

export type UploadValidationResult =
  | {
      ok: true
      buffer: ArrayBuffer
      /** The declared type, or the one the extension names when the client declared none. */
      contentType?: string
    }
  | { ok: false; error: string }

/**
 * Validates a File against a profile.
 *
 * Checks:
 * 1. File exists + has a name
 * 2. MIME type is in the whitelist
 * 3. Extension is in the whitelist (defensive — client might send generic MIME)
 * 4. Size <= maxBytes
 * 5. Magic bytes match the declared MIME (when known)
 */
export async function validateUpload(
  file: File,
  profile: UploadProfile
): Promise<UploadValidationResult> {
  if (!file?.name) {
    return { ok: false, error: 'No file provided' }
  }

  // ── Size check (cheap, do first) ─────────────────────────────────────────
  if (file.size === 0) {
    return { ok: false, error: 'File is empty' }
  }
  if (file.size > profile.maxBytes) {
    const mb = (profile.maxBytes / 1024 / 1024).toFixed(1)
    return { ok: false, error: `File too large. Max ${mb} MB.` }
  }

  // ── Extension check ──────────────────────────────────────────────────────
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  if (!profile.allowedExt.includes(ext)) {
    return {
      ok: false,
      error: `File extension .${ext} not allowed. Allowed: ${profile.allowedExt.map((e) => `.${e}`).join(', ')}`,
    }
  }

  // ── MIME check ───────────────────────────────────────────────────────────
  const mime = (file.type || '').toLowerCase()
  // If no MIME sent, fall back to extension-derived permission; otherwise must match whitelist.
  if (mime && !profile.allowedMime.includes(mime)) {
    return {
      ok: false,
      error: `MIME type ${mime} not allowed for profile "${profile.name}".`,
    }
  }

  // ── The extension and the declared type must agree ───────────────────────
  const namedByExtension = MIME_BY_EXT[ext]
  if (mime && namedByExtension && mime !== namedByExtension) {
    return {
      ok: false,
      error: `File extension .${ext} does not match its declared type ${mime}.`,
    }
  }

  // ── Magic-byte check ─────────────────────────────────────────────────────
  const buffer = await file.arrayBuffer()
  const head = new Uint8Array(buffer.slice(0, 16))

  // The declared type decides what the content must look like; with no declared type it is the
  // type the extension names. Sending no Content-Type used to skip this check altogether, so any
  // bytes passed as long as the file was called photo.jpg.
  const checkedAs = mime || namedByExtension
  const signatures = checkedAs ? MAGIC[checkedAs] : undefined
  if (signatures && signatures.length > 0) {
    const matches = signatures.some((sig) => {
      if (head.length < sig.length) return false
      for (let i = 0; i < sig.length; i++) {
        if (head[i] !== sig[i]) return false
      }
      return true
    })
    // A WebP is a RIFF container whose form type, at bytes 8-11, is "WEBP"; WAV and AVI share the
    // first four bytes.
    const notWebp =
      checkedAs === 'image/webp' &&
      !(head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50)
    if (!matches || notWebp) {
      return {
        ok: false,
        error: mime
          ? `File contents do not match declared type ${mime}. Possible tampering.`
          : `File contents do not match the .${ext} extension (${checkedAs}). Possible tampering.`,
      }
    }
  }

  // SVG: no binary magic bytes — validate content begins with <svg or <?xml
  if (checkedAs === 'image/svg+xml') {
    const textStart = new TextDecoder().decode(new Uint8Array(buffer.slice(0, 128)))
    const trimmed = textStart.trimStart()
    if (
      !trimmed.startsWith('<svg') &&
      !trimmed.startsWith('<?xml') &&
      !trimmed.startsWith('<SVG')
    ) {
      return { ok: false, error: 'Invalid SVG: file must begin with <svg or <?xml.' }
    }
  }

  return { ok: true, buffer, contentType: checkedAs }
}
