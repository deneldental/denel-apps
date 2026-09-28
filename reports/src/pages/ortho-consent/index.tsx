import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/api-client'
import { OrthoConsentContent } from './ortho-consent-content'

export default function OrthoConsentPage() {
  const [consentForms, setConsentForms] = useState<any[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadData() {
      try {
        const userRes = await apiClient<any>('/api/auth/session')
        if (userRes.success && userRes.data?.user) {
          // A rough approximation. The real app checks role.
          // Assuming non-doctors can edit based on original logic: `canEdit={!isDoctor}`
          // If the role isn't exactly "doctor" we allow edits.
          const isDoctor = userRes.data.user.role === 'doctor'
          setCanEdit(!isDoctor)
        }

        const formsRes = await apiClient<any[]>('/api/ortho-consent')
        if (formsRes.success && formsRes.data) {
          setConsentForms(formsRes.data)
        }
      } catch (error) {
        console.error('Failed to load ortho consent forms:', error)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  if (loading) {
    return <div className="p-8 flex items-center justify-center">Loading consent forms...</div>
  }

  return <OrthoConsentContent consentForms={consentForms} canEdit={canEdit} />
}
