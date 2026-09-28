/**
 * Every avatar upload must create its own file. Photos used to be stored under
 * the patient's NAME (`avatars/<name>.jpg`) — two patients with the same name
 * overwrote each other's photo, and adults added from the dashboard all shared
 * `avatars/patient.jpg`, so each new patient's photo replaced everyone else's.
 */
import { fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/actions/upload', () => ({ uploadFile: vi.fn() }))
// The crop dialog needs a real canvas; jsdom has none. Confirm the crop
// immediately so the upload path runs.
vi.mock('@/shared/components/avatar-cropper-dialog', () => ({
  AvatarCropperDialog: ({
    open,
    onCropped,
  }: {
    open: boolean
    onCropped: (blob: Blob) => void
  }) => {
    if (open) setTimeout(() => onCropped(new Blob(['x'], { type: 'image/jpeg' })), 0)
    return null
  },
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { uploadFile } from '@/lib/actions/upload'
import AvatarUpload from '@/shared/components/ui/avatar-upload'
import { renderWithRouter } from './_test-utils'

let clock: number
beforeEach(() => {
  clock = 1_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => clock++)
  vi.mocked(uploadFile).mockResolvedValue({ success: true, url: 'https://x/a.jpg' } as never)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

async function uploadOnePhoto(entityName: string) {
  const { container, unmount } = renderWithRouter(<AvatarUpload entityName={entityName} />)
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File(['img'], 'photo.png', { type: 'image/png' })
  fireEvent.change(input, { target: { files: [file] } })
  await waitFor(() => expect(vi.mocked(uploadFile)).toHaveBeenCalled())
  unmount()
  const call = vi.mocked(uploadFile).mock.calls.at(-1)
  return call?.[1] as { storageCategory?: string; folder?: string; name?: string }
}

describe('AvatarUpload file naming', () => {
  it('gives two patients with the same name two different files', async () => {
    const first = await uploadOnePhoto('Ama Mensah')
    const second = await uploadOnePhoto('Ama Mensah')

    expect(first.folder).toBe('avatars')
    expect(first.name).not.toBe(second.name)
  })

  it('gives adults added without a name (the dashboard flow) unique files too', async () => {
    const first = await uploadOnePhoto('patient')
    const second = await uploadOnePhoto('patient')

    expect(first.name).not.toBe(second.name)
  })
})
