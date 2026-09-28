import { api } from '@/lib/api-client'

interface UploadStaffFileOptions {
  file: File
  staffName: string
  documentTitle: string
  bucketName?: string
}

export async function uploadStaffFile({
  file,
  staffName,
  documentTitle,
  bucketName,
}: UploadStaffFileOptions): Promise<{ success: boolean; url?: string; error?: string }> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('name', staffName)
  formData.append('storageCategory', 'staff')
  formData.append('folder', 'staff')
  formData.append('subfolder', documentTitle.toLowerCase().replace(/\s+/g, '_'))

  // Use the generic upload endpoint
  const res = await api.post<any>('/api/upload', formData)
  return res
}
