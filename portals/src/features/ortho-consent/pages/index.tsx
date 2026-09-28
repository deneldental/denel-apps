import { useEffect } from 'react'
import { getOrthoConsentForms } from '@/lib/actions/ortho-consent'
import { useLoading } from '@/lib/loading-context'
import { useCan } from '@/lib/permissions-context'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { OrthoConsentContent } from './ortho-consent-content'

export default function OrthoConsentPage() {
  // Consent forms are a clinical record — gate on the module permission the
  // backend enforces, not on the role (doctors hold `ortho_consent:*`).
  const canEdit = useCan('ortho_consent', 'update')
  const { setIsLoading } = useLoading()

  const formsQuery = useApiQuery(queryKeys.orthoConsent.list(), () => getOrthoConsentForms())
  const consentForms = formsQuery.data ?? []

  useEffect(() => {
    setIsLoading(formsQuery.isFetching)
  }, [formsQuery.isFetching, setIsLoading])

  if (formsQuery.isLoading) return null

  return (
    <OrthoConsentContent
      consentForms={consentForms}
      canEdit={canEdit}
      onReload={() => formsQuery.refetch()}
    />
  )
}
