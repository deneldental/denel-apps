import { describe, expect, it } from 'vitest'
import { uploadProfiles, validateUpload } from '../../src/lib/upload-validation'

// Magic-byte prefixes for common formats (must match the helper's internal table)
const JPEG_MAGIC = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])

/**
 * Build a minimal File with a chosen magic-byte prefix + padding.
 * Pads with zero-bytes up to `totalBytes` to simulate size.
 */
function makeFile(name: string, mime: string, magic: Uint8Array, totalBytes = 128): File {
  const padded = new Uint8Array(Math.max(totalBytes, magic.length))
  padded.set(magic, 0)
  return new File([padded], name, { type: mime })
}

describe('validateUpload — image profile', () => {
  const profile = uploadProfiles.image

  it('accepts a valid JPEG', async () => {
    const file = makeFile('photo.jpg', 'image/jpeg', JPEG_MAGIC)
    const result = await validateUpload(file, profile)
    expect(result.ok).toBe(true)
  })

  it('accepts a valid PNG', async () => {
    const file = makeFile('photo.png', 'image/png', PNG_MAGIC)
    const result = await validateUpload(file, profile)
    expect(result.ok).toBe(true)
  })

  it('rejects a PDF for image profile', async () => {
    const file = makeFile('doc.pdf', 'application/pdf', PDF_MAGIC)
    const result = await validateUpload(file, profile)
    expect(result.ok).toBe(false)
    // Either extension or MIME check catches it — both are valid rejections
    if (!result.ok) expect(result.error).toMatch(/(extension|MIME).*not allowed/)
  })

  it('rejects when extension does not match whitelist', async () => {
    const file = makeFile('photo.exe', 'image/jpeg', JPEG_MAGIC)
    const result = await validateUpload(file, profile)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/extension .exe not allowed/)
  })

  it('rejects when size exceeds limit', async () => {
    const file = makeFile('big.jpg', 'image/jpeg', JPEG_MAGIC, profile.maxBytes + 1)
    const result = await validateUpload(file, profile)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/too large/)
  })

  it('rejects empty files', async () => {
    const file = new File([new Uint8Array(0)], 'empty.jpg', { type: 'image/jpeg' })
    const result = await validateUpload(file, profile)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/empty/i)
  })

  it('rejects renamed file — declared JPEG but magic bytes are PDF (magic mismatch)', async () => {
    // Attacker renames a PDF as .jpg + sends image/jpeg Content-Type; magic-byte check catches it
    const file = makeFile('fake.jpg', 'image/jpeg', PDF_MAGIC)
    const result = await validateUpload(file, profile)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/do not match declared type|Possible tampering/)
  })
})

describe('validateUpload — pdf profile', () => {
  const profile = uploadProfiles.pdf

  it('accepts a valid PDF', async () => {
    const file = makeFile('doc.pdf', 'application/pdf', PDF_MAGIC)
    const result = await validateUpload(file, profile)
    expect(result.ok).toBe(true)
  })

  it('rejects a JPEG for pdf-only profile', async () => {
    const file = makeFile('photo.jpg', 'image/jpeg', JPEG_MAGIC)
    const result = await validateUpload(file, profile)
    expect(result.ok).toBe(false)
  })

  it('has a 25 MB limit', () => {
    expect(profile.maxBytes).toBe(25 * 1024 * 1024)
  })
})

describe('validateUpload — imageOrPdf profile', () => {
  const profile = uploadProfiles.imageOrPdf

  it('accepts both images and PDFs', async () => {
    const jpeg = makeFile('photo.jpg', 'image/jpeg', JPEG_MAGIC)
    const pdf = makeFile('doc.pdf', 'application/pdf', PDF_MAGIC)
    expect((await validateUpload(jpeg, profile)).ok).toBe(true)
    expect((await validateUpload(pdf, profile)).ok).toBe(true)
  })

  it('rejects CSV', async () => {
    const file = new File(['a,b\n1,2'], 'data.csv', { type: 'text/csv' })
    const result = await validateUpload(file, profile)
    expect(result.ok).toBe(false)
  })
})

describe('validateUpload — edge cases', () => {
  it('rejects missing file name gracefully', async () => {
    const result = await validateUpload(null as unknown as File, uploadProfiles.image)
    expect(result.ok).toBe(false)
  })

  it('accepts file without MIME header if extension is allowed (dev uploads)', async () => {
    const file = makeFile('photo.jpg', '', JPEG_MAGIC)
    const result = await validateUpload(file, uploadProfiles.image)
    // extension passes; MIME empty skips strict check; magic-byte skipped when no MIME known
    expect(result.ok).toBe(true)
  })
})

describe('uploadProfiles constants', () => {
  it('profiles have sensible size limits', () => {
    expect(uploadProfiles.image.maxBytes).toBeLessThanOrEqual(20 * 1024 * 1024)
    expect(uploadProfiles.pdf.maxBytes).toBeLessThanOrEqual(50 * 1024 * 1024)
    expect(uploadProfiles.csv.maxBytes).toBeLessThanOrEqual(10 * 1024 * 1024)
  })

  it('image profile includes JPEG and PNG', () => {
    expect(uploadProfiles.image.allowedMime).toContain('image/jpeg')
    expect(uploadProfiles.image.allowedMime).toContain('image/png')
  })
})
