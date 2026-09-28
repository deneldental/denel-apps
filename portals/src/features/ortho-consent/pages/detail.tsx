import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getOrthoConsentForms } from '@/lib/actions/ortho-consent'
import { useLoading } from '@/lib/loading-context'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { ConsentFormViewer } from './consent-form-viewer'

export default function ConsentFormPage() {
  const { patientId } = useParams<{ patientId: string }>()
  const navigate = useNavigate()
  const { setIsLoading } = useLoading()

  // Same list + key as the index page — no per-id endpoint exists, so this
  // finds one row out of the shared full-list cache.
  const formsQuery = useApiQuery(queryKeys.orthoConsent.list(), () => getOrthoConsentForms())
  const consentForm = formsQuery.data?.find((f: any) => f.id === patientId) ?? null

  useEffect(() => {
    setIsLoading(formsQuery.isFetching)
  }, [formsQuery.isFetching, setIsLoading])

  useEffect(() => {
    if (formsQuery.isError || (!formsQuery.isLoading && !consentForm)) {
      navigate('/ortho-consent')
    }
  }, [formsQuery.isError, formsQuery.isLoading, consentForm, navigate])

  if (formsQuery.isLoading) return null
  if (!consentForm) return null

  return <ConsentFormViewer consentForm={consentForm} onReload={() => formsQuery.refetch()} />
}
