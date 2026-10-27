/**
 * The product and inventory image uploader (F22) — see
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.12).
 *
 * It posted the image with a bare `fetch()` that carried the session cookie but neither the CSRF
 * token nor the app id the backend requires on every POST, so the backend refused it and the
 * screen said "Failed to upload image" every time. It now goes through the shared upload action
 * like every other screen, which uses the app's API client (that adds both).
 */
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SingleImageUpload } from '@/features/products/components/single-image-upload'
import { renderWithRouter } from './_test-utils'

vi.mock('@/lib/actions/upload', () => ({ uploadFile: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { toast } from 'sonner'
import { uploadFile } from '@/lib/actions/upload'

const upload = vi.mocked(uploadFile)

const PNG = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'gloves.png', {
  type: 'image/png',
})

beforeEach(() => {
  vi.resetAllMocks()
  // jsdom has no object URLs; the file hook makes a preview of every file it accepts.
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})

function pick(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  return userEvent.upload(input, file)
}

describe('SingleImageUpload', () => {
  it('uploads through the shared action, as an image, to its own folder', async () => {
    upload.mockResolvedValue({ success: true, url: 'private-file://r2/products/x.png#t' })
    const onChange = vi.fn()
    renderWithRouter(
      <SingleImageUpload image={null} onChange={onChange} folder="products" entityName="Gloves" />
    )

    await pick(PNG)

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('private-file://r2/products/x.png#t'))
    expect(upload).toHaveBeenCalledTimes(1)
    expect(upload).toHaveBeenCalledWith(expect.any(File), {
      storageCategory: 'system_docs',
      folder: 'products',
      name: 'Gloves',
      profile: 'image',
    })
  })

  it('uses the inventory folder for an inventory item', async () => {
    upload.mockResolvedValue({ success: true, url: 'u' })
    renderWithRouter(
      <SingleImageUpload image={null} onChange={vi.fn()} folder="inventory" entityName="Gauze" />
    )
    await pick(PNG)
    await waitFor(() => expect(upload).toHaveBeenCalled())
    expect(upload.mock.calls[0][1]).toMatchObject({ folder: 'inventory', name: 'Gauze' })
  })

  it('never makes a request of its own (a bare fetch has no CSRF token)', async () => {
    upload.mockResolvedValue({ success: true, url: 'u' })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    renderWithRouter(
      <SingleImageUpload image={null} onChange={vi.fn()} folder="products" entityName="Gloves" />
    )
    await pick(PNG)
    await waitFor(() => expect(upload).toHaveBeenCalled())
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('says why when the upload is refused, and keeps the previous image', async () => {
    upload.mockResolvedValue({
      success: false,
      error: 'You do not have permission to upload this kind of file.',
    })
    const onChange = vi.fn()
    renderWithRouter(
      <SingleImageUpload image={null} onChange={onChange} folder="products" entityName="Gloves" />
    )
    await pick(PNG)
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'You do not have permission to upload this kind of file.'
      )
    )
    expect(onChange).not.toHaveBeenCalled()
  })

  it('treats a success without a url as a failure', async () => {
    upload.mockResolvedValue({ success: true })
    const onChange = vi.fn()
    renderWithRouter(
      <SingleImageUpload image={null} onChange={onChange} folder="products" entityName="Gloves" />
    )
    await pick(PNG)
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(onChange).not.toHaveBeenCalled()
  })

  it('shows the current image with a way to remove it', async () => {
    const onChange = vi.fn()
    renderWithRouter(
      <SingleImageUpload
        image="https://example.test/a.png"
        onChange={onChange}
        folder="products"
        entityName="x"
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onChange).toHaveBeenCalledWith(null)
  })
})
