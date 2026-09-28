import { api } from '@/lib/api-client'

/**
 * Format date as ddMMMyyyy (e.g., 15mar2025)
 */
function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0')
  const months = [
    'jan',
    'feb',
    'mar',
    'apr',
    'may',
    'jun',
    'jul',
    'aug',
    'sep',
    'oct',
    'nov',
    'dec',
  ]
  const month = months[date.getMonth()]
  const year = date.getFullYear()
  return `${day}${month}${year}`
}

/**
 * Sanitize name for use in filenames
 */
function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .trim()
}

/**
 * Generate filename
 */
export async function generateFileName(
  name: string,
  date: Date,
  extension: string,
  index?: number
): Promise<string> {
  const sanitized = sanitizeName(name)
  const formattedDate = formatDate(date)
  const ext = extension.startsWith('.') ? extension : `.${extension}`

  if (index !== undefined) {
    const indexStr = String(index).padStart(3, '0')
    return `${sanitized}_${formattedDate}_${indexStr}${ext}`
  }

  return `${sanitized}_${formattedDate}${ext}`
}

type FolderName = 'avatars' | 'consent-forms' | 'treatments' | 'products' | 'inventory'
type StorageCategory = 'patient_records' | 'staff' | 'system_docs' | 'misc'

const FOLDER_TO_CATEGORY: Record<FolderName, StorageCategory> = {
  avatars: 'staff',
  'consent-forms': 'patient_records',
  treatments: 'patient_records',
  products: 'system_docs',
  inventory: 'system_docs',
}

/**
 * Upload a file via Backend. The bucket is decided by the storage routing in
 * the admin Integrations UI (mapped from `folder` to a storage category).
 */
export async function uploadFile(params: {
  folder: FolderName
  fileName: string
  fileBuffer: Blob | ArrayBuffer
  contentType: string
  subfolder?: string
}): Promise<{ success: boolean; url?: string; error?: string }> {
  const formData = new FormData()
  formData.append(
    'file',
    params.fileBuffer instanceof Blob ? params.fileBuffer : new Blob([params.fileBuffer])
  )
  formData.append('storageCategory', FOLDER_TO_CATEGORY[params.folder])
  formData.append('folder', params.folder)
  formData.append('name', params.fileName)
  if (params.subfolder) formData.append('subfolder', params.subfolder)

  return api.post<any>('/api/upload', formData)
}

/**
 * Delete a file via Backend
 */
export async function deleteFile(fileUrl: string): Promise<{ success: boolean; error?: string }> {
  return api.post<any>('/api/upload/delete', { fileUrl })
}
