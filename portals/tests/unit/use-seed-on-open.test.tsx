/**
 * An edit sheet fills its fields when it opens. A background refetch hands the
 * same record back as a new object — every 15 minutes a private file's link is
 * re-signed, so the record really does differ — and must not wipe what the
 * user is typing.
 */
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useSeedOnOpen } from '@/shared/hooks/use-seed-on-open'

type Props = { open: boolean; record: { id: string; photo: string } }

function setup(initial: Props) {
  const seed = vi.fn()
  const hook = renderHook(
    ({ open, record }: Props) => useSeedOnOpen(open, record.id, () => seed(record)),
    { initialProps: initial }
  )
  return { seed, ...hook }
}

const A1 = { id: 'a', photo: 'https://x/a.jpg?X-Amz-Date=20260927T100000Z' }
const A2 = { id: 'a', photo: 'https://x/a.jpg?X-Amz-Date=20260927T101500Z' }
const B = { id: 'b', photo: 'https://x/b.jpg?X-Amz-Date=20260927T101500Z' }

describe('useSeedOnOpen', () => {
  it('fills the form when the sheet opens', async () => {
    const { seed } = setup({ open: true, record: A1 })

    await waitFor(() => expect(seed).toHaveBeenCalledWith(A1))
  })

  it('does not refill it when a refetch returns the same record with a fresh link', async () => {
    const { seed, rerender } = setup({ open: true, record: A1 })
    await waitFor(() => expect(seed).toHaveBeenCalledTimes(1))

    rerender({ open: true, record: A2 })
    await new Promise((r) => setTimeout(r, 0))

    expect(seed).toHaveBeenCalledTimes(1)
  })

  it('refills it with fresh data when the sheet is closed and opened again', async () => {
    const { seed, rerender } = setup({ open: true, record: A1 })
    await waitFor(() => expect(seed).toHaveBeenCalledTimes(1))

    rerender({ open: false, record: A2 })
    rerender({ open: true, record: A2 })

    await waitFor(() => expect(seed).toHaveBeenLastCalledWith(A2))
    expect(seed).toHaveBeenCalledTimes(2)
  })

  it('refills it when a different record is opened', async () => {
    const { seed, rerender } = setup({ open: true, record: A1 })
    await waitFor(() => expect(seed).toHaveBeenCalledTimes(1))

    rerender({ open: true, record: B })

    await waitFor(() => expect(seed).toHaveBeenLastCalledWith(B))
  })

  it('does nothing while the sheet is closed', async () => {
    const { seed } = setup({ open: false, record: A1 })
    await new Promise((r) => setTimeout(r, 0))

    expect(seed).not.toHaveBeenCalled()
  })
})
