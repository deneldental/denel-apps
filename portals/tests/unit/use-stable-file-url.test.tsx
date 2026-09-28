/**
 * An embedded viewer (a PDF iframe, an image) must not reload because the
 * file's link was re-signed — that jumps a PDF back to page 1 while it is being
 * read. It reloads only when a different file (or none) is shown.
 */
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useStableFileUrl } from '@/shared/hooks/use-stable-file-url'

const link = (file: string, window: string) =>
  `https://denel-private.acct.r2.cloudflarestorage.com/${file}?X-Amz-Date=20260927T${window}00Z&X-Amz-Signature=${window}`

describe('useStableFileUrl', () => {
  it('keeps the first link while the same file is re-signed', () => {
    const { result, rerender } = renderHook(({ url }) => useStableFileUrl(url), {
      initialProps: { url: link('consent.pdf', '1000') as string | null },
    })

    rerender({ url: link('consent.pdf', '1015') })

    expect(result.current).toBe(link('consent.pdf', '1000'))
  })

  it('switches when a different file is shown', () => {
    const { result, rerender } = renderHook(({ url }) => useStableFileUrl(url), {
      initialProps: { url: link('consent.pdf', '1000') as string | null },
    })

    rerender({ url: link('other.pdf', '1015') })

    expect(result.current).toBe(link('other.pdf', '1015'))
  })

  it('follows the file being removed and added again', () => {
    const { result, rerender } = renderHook(({ url }) => useStableFileUrl(url), {
      initialProps: { url: link('consent.pdf', '1000') as string | null },
    })

    rerender({ url: null })
    expect(result.current).toBeNull()

    rerender({ url: link('consent.pdf', '1030') })
    expect(result.current).toBe(link('consent.pdf', '1030'))
  })
})
