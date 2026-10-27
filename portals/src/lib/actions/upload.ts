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

  const res = await api.post<any>('/api/upload/expense', formData)
  return res
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
 *
 * The backend accepts only the folders it knows (backend/src/lib/upload-policy.ts): each one is a
 * kind of file with its own category, permission and validation profile, and the server generates
 * the object name (`name` is only a hint). A new folder needs a new kind there first, or the call
 * is refused with 400 UPLOAD_PATH_UNKNOWN; a test fails until the two agree.
 *
 * Examples:
 *   uploadFile(file, { storageCategory: 'patient_records', folder: 'patients', subfolder: `${patientId}/photos`, profile: 'image' })
 *   uploadFile(file, { storageCategory: 'system_docs', folder: 'compliance', profile: 'imageOrPdf' })
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

  const res = await api.post<any>('/api/upload', formData)
  return res
}
