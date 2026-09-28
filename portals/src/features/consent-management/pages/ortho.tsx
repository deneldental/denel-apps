// Ortho consent — re-exports the existing ortho-consent page.
// The OrthoConsent feature remains canonical; this surfaces it under /consents/ortho.
import OrthoConsentPage from '@/features/ortho-consent/pages/index'

export default function ConsentOrthoPage() {
  return <OrthoConsentPage />
}
