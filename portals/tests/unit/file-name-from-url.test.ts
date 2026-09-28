/**
 * Screens show a stored file's name. Private files arrive as signed links
 * (`…/receipt%20(1).pdf?X-Amz-Algorithm=…`); the name is the last path part,
 * decoded — never the signature.
 */
import { describe, expect, it } from 'vitest'
import { fileNameFromUrl, isSameStoredFile, isSameStoredFileValue } from '@/shared/lib/file-name'

describe('fileNameFromUrl', () => {
  it('drops the signature from a signed link and decodes the name', () => {
    expect(
      fileNameFromUrl(
        'https://denel-private.acct.r2.cloudflarestorage.com/compliance/receipt%20(1).pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc'
      )
    ).toBe('receipt (1).pdf')
  })

  it('reads a plain public link', () => {
    expect(fileNameFromUrl('https://pub-test.r2.dev/compliance/licence.pdf')).toBe('licence.pdf')
  })

  it('falls back to the text after the last slash for anything else', () => {
    expect(fileNameFromUrl('private-file://r2/compliance/cert.pdf#0123456789abcdef')).toBe(
      'cert.pdf'
    )
  })
})

describe('isSameStoredFile', () => {
  const at = (date: string, signature: string) =>
    `https://denel-private.acct.r2.cloudflarestorage.com/SYS/alerts/chime.mp3?X-Amz-Date=${date}&X-Amz-Signature=${signature}`

  it('treats two signed links to the same file as the same file', () => {
    expect(isSameStoredFile(at('20260927T100000Z', 'aaa'), at('20260927T101500Z', 'bbb'))).toBe(
      true
    )
  })

  it('tells different files apart', () => {
    expect(
      isSameStoredFile(
        at('20260927T100000Z', 'aaa'),
        'https://denel-private.acct.r2.cloudflarestorage.com/SYS/alerts/bell.mp3?X-Amz-Date=20260927T100000Z'
      )
    ).toBe(false)
  })

  it('compares anything that is not a link as it is', () => {
    expect(isSameStoredFile('data:audio/mpeg;base64,AAA', 'data:audio/mpeg;base64,AAA')).toBe(true)
    expect(isSameStoredFile('data:audio/mpeg;base64,AAA', 'data:audio/mpeg;base64,BBB')).toBe(false)
  })
})

describe('isSameStoredFileValue', () => {
  it('treats empty values alike and a refreshed link as unchanged', () => {
    expect(isSameStoredFileValue(null, '')).toBe(true)
    expect(isSameStoredFileValue(undefined, null)).toBe(true)
    expect(
      isSameStoredFileValue('https://h/p/a.jpg?X-Amz-Date=1', 'https://h/p/a.jpg?X-Amz-Date=2')
    ).toBe(true)
  })

  it('sees an added, removed or replaced file as a change', () => {
    expect(isSameStoredFileValue(null, 'https://h/p/a.jpg')).toBe(false)
    expect(isSameStoredFileValue('https://h/p/a.jpg', '')).toBe(false)
    expect(isSameStoredFileValue('https://h/p/a.jpg', 'https://h/p/b.jpg')).toBe(false)
  })
})
