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

describe('validateUpload — the content is checked even when the client sends no type (F22 review)', () => {
  const TEXT = (text: string) => new TextEncoder().encode(text)
  const noType = (name: string, bytes: Uint8Array) => new File([bytes], name, { type: '' })

  it('rejects a PDF renamed .jpg when no Content-Type is sent', async () => {
    const result = await validateUpload(noType('fake.jpg', PDF_MAGIC), uploadProfiles.image)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/do not match/)
  })

  it('rejects an HTML page named .png when no Content-Type is sent', async () => {
    const html = TEXT('<html><script>alert(1)</script></html>')
    const result = await validateUpload(noType('evil.png', html), uploadProfiles.image)
    expect(result.ok).toBe(false)
  })

  it('rejects a JPEG named .pdf when no Content-Type is sent', async () => {
    const result = await validateUpload(noType('scan.pdf', JPEG_MAGIC), uploadProfiles.pdf)
    expect(result.ok).toBe(false)
  })

  it.each([
    ['photo.jpg', JPEG_MAGIC, uploadProfiles.image],
    ['photo.jpeg', JPEG_MAGIC, uploadProfiles.image],
    ['PHOTO.JPG', JPEG_MAGIC, uploadProfiles.image],
    ['photo.png', PNG_MAGIC, uploadProfiles.image],
    ['doc.pdf', PDF_MAGIC, uploadProfiles.pdf],
  ])('still accepts a genuine %s with no Content-Type', async (name, magic, profile) => {
    expect((await validateUpload(noType(name, magic), profile)).ok).toBe(true)
  })

  it('does not look inside audio or video, which have no signature here', async () => {
    const mp3 = noType('sound.mp3', TEXT('ID3-not-really-audio'))
    expect((await validateUpload(mp3, uploadProfiles.audio)).ok).toBe(true)
  })
})

describe('validateUpload — a file must be what its extension says (F22 review)', () => {
  it.each([
    ['photo.pdf', 'image/png', PNG_MAGIC],
    ['photo.png', 'image/jpeg', JPEG_MAGIC],
    ['photo.jpg', 'image/png', PNG_MAGIC],
    ['doc.png', 'application/pdf', PDF_MAGIC],
  ])('rejects %s declared as %s even though the bytes match the declared type', async (name, mime, magic) => {
    const result = await validateUpload(makeFile(name, mime, magic), uploadProfiles.imageOrPdf)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/extension/)
  })

  it('accepts .jpg and .jpeg for image/jpeg', async () => {
    expect(
      (await validateUpload(makeFile('a.jpg', 'image/jpeg', JPEG_MAGIC), uploadProfiles.image)).ok
    ).toBe(true)
    expect(
      (await validateUpload(makeFile('a.jpeg', 'image/jpeg', JPEG_MAGIC), uploadProfiles.image)).ok
    ).toBe(true)
  })
})

describe('validateUpload — WebP is more than a RIFF header (F22 review)', () => {
  const riff = (kind: string) => {
    const bytes = new Uint8Array(32)
    bytes.set([0x52, 0x49, 0x46, 0x46], 0) // RIFF
    bytes.set(new TextEncoder().encode(kind), 8)
    return bytes
  }

  it('accepts RIFF....WEBP', async () => {
    const file = new File([riff('WEBP')], 'a.webp', { type: 'image/webp' })
    expect((await validateUpload(file, uploadProfiles.image)).ok).toBe(true)
  })

  it('rejects another RIFF container (WAVE, AVI) named .webp', async () => {
    for (const kind of ['WAVE', 'AVI ']) {
      const file = new File([riff(kind)], 'a.webp', { type: 'image/webp' })
      const result = await validateUpload(file, uploadProfiles.image)
      expect(result.ok, kind).toBe(false)
    }
  })

  it('rejects it with no Content-Type too', async () => {
    const file = new File([riff('WAVE')], 'a.webp', { type: '' })
    expect((await validateUpload(file, uploadProfiles.image)).ok).toBe(false)
  })
})

describe('validateUpload — the content type to store (review)', () => {
  it('is the type the client declared', async () => {
    const result = await validateUpload(
      makeFile('a.png', 'image/png', PNG_MAGIC),
      uploadProfiles.image
    )
    expect(result.ok && result.contentType).toBe('image/png')
  })

  it('is the type the extension names when the client declared none', async () => {
    const file = new File([PNG_MAGIC], 'a.png', { type: '' })
    const result = await validateUpload(file, uploadProfiles.image)
    expect(result.ok && result.contentType).toBe('image/png')
  })

  it('is undefined for a format with no content check and no declared type', async () => {
    const result = await validateUpload(
      new File([new TextEncoder().encode('ID3-not-really-audio')], 'sound.mp3', { type: '' }),
      uploadProfiles.audio
    )
    expect(result.ok && result.contentType).toBeUndefined()
  })
})

describe('validateUpload — an SVG is checked even when no type is declared (review)', () => {
  const svg = (name: string, text: string, type = '') =>
    new File([new TextEncoder().encode(text)], name, { type })

  it('refuses a .svg that is not an SVG', async () => {
    const result = await validateUpload(
      svg('logo.svg', '<html><script>alert(1)</script></html>'),
      uploadProfiles.logo
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/SVG/)
  })

  it('accepts a .svg that is one, and names its type', async () => {
    const result = await validateUpload(
      svg('logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      uploadProfiles.logo
    )
    expect(result.ok).toBe(true)
    expect(result.ok && result.contentType).toBe('image/svg+xml')
  })

  it('still refuses it when the client did declare the type', async () => {
    const result = await validateUpload(
      svg('logo.svg', '<html></html>', 'image/svg+xml'),
      uploadProfiles.logo
    )
    expect(result.ok).toBe(false)
  })

  it('refuses a .svg declared as another type', async () => {
    const result = await validateUpload(
      svg('logo.svg', '<svg></svg>', 'image/png'),
      uploadProfiles.logo
    )
    expect(result.ok).toBe(false)
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
