import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getOrthoConsentForms } from '@/lib/actions/ortho-consent'
import { ConsentFormViewer } from './consent-form-viewer'

export default function ConsentFormPage() {
  const navigate = useNavigate()
  const params = useParams()
  const patientId = params.patientId as string
  const [loading, setLoading] = useState(true)
  const [consentForm, setConsentForm] = useState<any>(null)

  useEffect(() => {
    async function fetchConsentForm() {
      try {
        const result = await getOrthoConsentForms()

        if (!result.success) {
          navigate('/patient-records/ortho-consent')
          return
        }

        const allForms = result.data || []
        const form = allForms.find((f) => f.id === patientId)

        if (!form) {
          navigate('/patient-records/ortho-consent')
          return
        }

        setConsentForm(form)
      } catch (error) {
        console.error('Failed to fetch consent form:', error)
        navigate('/patient-records/ortho-consent')
      } finally {
        setLoading(false)
      }
    }

    fetchConsentForm()
  }, [navigate, patientId])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!consentForm) {
    return null
  }

  return <ConsentFormViewer consentForm={consentForm} />
}
