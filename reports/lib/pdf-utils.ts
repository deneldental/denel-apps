import { api } from '@/lib/api-client'

/**
 * Generate Consent Form Template from Backend
 */
export async function generateConsentFormTemplate(): Promise<Blob | null> {
  const res = await fetch(`${import.meta.env.NEXT_PUBLIC_API_URL}/api/ortho-consent/template`)
  if (res.ok) return res.blob()
  return null
}

/**
 * Process and Validate handled by Backend
 */
export async function processUploadedConsentForm(uploadedPdfBlob: Blob): Promise<Blob | null> {
  const formData = new FormData()
  formData.append('file', uploadedPdfBlob)
  const res = await api.post<any>('/api/ortho-consent/process', formData)
  if (res.success && res.data?.url) {
    const fileRes = await fetch(res.data.url)
    return fileRes.blob()
  }
  return null
}
