import { api } from '@/lib/api-client'

interface UploadExpenseFileOptions {
  file: File
  category: string
  paidTo?: string | null
  date: Date
}

/**
 * Upload an expense receipt to DigitalOcean Spaces via the backend.
 * The backend handles S3 credentials and filename generation.
 */
export async function uploadExpenseFile({
  file,
  category,
  paidTo,
  date,
}: UploadExpenseFileOptions): Promise<{ success: boolean; url?: string; error?: string }> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('category', category)
  if (paidTo) formData.append('paidTo', paidTo)
  formData.append('date', date.toISOString())

  const res = await api.post('/api/upload/expense', formData)
  // The backend returns `url` at the top level (not nested under `data`);
  // ApiResponse only types it via its catch-all index signature, hence the check.
  return {
    success: res.success,
    url: typeof res.url === 'string' ? res.url : undefined,
    error: res.error,
  }
}

/**
 * Validation profiles — mirror of backend `uploadProfiles`. Passed via `profile`
 * form field to trigger server-side MIME whitelist + size + magic-byte checks.
 */
export type UploadProfile = 'image' | 'pdf' | 'csv' | 'imageOrPdf' | 'video' | 'audio'
export type StorageCategory = 'patient_records' | 'staff' | 'system_docs' | 'misc'

/**
 * Generic file upload via backend. The active provider for the chosen
 * `storageCategory` is decided by the admin Integrations UI; callers do not
 * pick a bucket or endpoint here.
 */
export async function uploadFile(
  file: File,
  options?: {
    storageCategory?: StorageCategory
    folder?: string
    subfolder?: string
    name?: string
    profile?: UploadProfile
  }
): Promise<{ success: boolean; url?: string; error?: string }> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('storageCategory', options?.storageCategory ?? 'misc')
  if (options?.folder) formData.append('folder', options.folder)
  if (options?.subfolder) formData.append('subfolder', options.subfolder)
  if (options?.name) formData.append('name', options.name)
  if (options?.profile) formData.append('profile', options.profile)

  const res = await api.post('/api/upload', formData)
  // The backend returns `url` at the top level (not nested under `data`);
  // ApiResponse only types it via its catch-all index signature, hence the check.
  return {
    success: res.success,
    url: typeof res.url === 'string' ? res.url : undefined,
    error: res.error,
  }
}
