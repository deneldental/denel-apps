import { api } from '@/lib/api-client'

interface UploadStaffFileOptions {
  file: File
  staffName: string
  documentTitle: string
}

export async function uploadStaffFile({
  file,
  staffName,
  documentTitle,
}: UploadStaffFileOptions): Promise<{ success: boolean; url?: string; error?: string }> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('name', staffName)
  formData.append('storageCategory', 'staff')
  formData.append('folder', 'staff')
  formData.append('subfolder', documentTitle.toLowerCase().replace(/\s+/g, '_'))

  // Use the generic upload endpoint. The backend returns `url` at the top
  // level (not nested under `data`); ApiResponse only types it via its
  // catch-all index signature, hence the check.
  const res = await api.post('/api/upload', formData)
  return {
    success: res.success,
    url: typeof res.url === 'string' ? res.url : undefined,
    error: res.error,
  }
}
