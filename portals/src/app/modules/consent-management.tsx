import { PenLine } from 'lucide-react'
import { Navigate, Route, useParams } from 'react-router-dom'
import { ConsentLayout } from '@/features/consent-management/consent-layout'
import AllConsentsPage from '@/features/consent-management/pages/index'
import ConsentOrthoPage from '@/features/consent-management/pages/ortho'
import ConsentPendingPage from '@/features/consent-management/pages/pending'
import ConsentSignPage from '@/features/consent-management/pages/sign'
import ConsentSurgicalPage from '@/features/consent-management/pages/surgical'
import OrthoConsentDetailPage from '@/features/ortho-consent/pages/detail'
import type { Module } from './types'

/**
 * `/ortho-consent/:patientId` → `/consents/ortho/:patientId`, keeping the record.
 * A plain `<Navigate to="/consents/ortho/:patientId">` does not substitute the
 * parameter, so the old redirect sent people to the literal text ":patientId".
 */
function LegacyOrthoConsentRedirect() {
  const { patientId } = useParams<{ patientId: string }>()
  return (
    <Navigate
      to={patientId ? `/consents/ortho/${encodeURIComponent(patientId)}` : '/consents/ortho'}
      replace
    />
  )
}

export const consentManagementModule: Module = {
  id: 'consent-management',
  label: 'Consents',
  order: 13.5,
  // The sidebar entry is the ortho consent list, for anyone who holds `ortho_consent`
  // (decision D13): doctors and reception had no menu path to these pages at all. The
  // rest of the hub is reached from inside it, through its sub-navigation.
  hasAccess: (can) => can('ortho_consent', 'read'),
  routes: [
    <Route key="consent-layout" element={<ConsentLayout />}>
      <Route path="/consents" element={<AllConsentsPage />} />
      <Route path="/consents/pending" element={<ConsentPendingPage />} />
      <Route path="/consents/ortho" element={<ConsentOrthoPage />} />
      <Route path="/consents/ortho/:patientId" element={<OrthoConsentDetailPage />} />
      <Route path="/consents/surgical" element={<ConsentSurgicalPage />} />
      <Route path="/consents/sign" element={<ConsentSignPage />} />
      {/* Legacy redirects */}
      <Route path="/ortho-consent" element={<Navigate to="/consents/ortho" replace />} />
      <Route path="/ortho-consent/:patientId" element={<LegacyOrthoConsentRedirect />} />
      {/* Templates is hidden until Documents v3 is in scope (decision D5): its actions
          led to the removed /documents pages. The page file is left intact, unrouted.
          Old links land on the Consents home. */}
      <Route path="/consents/templates" element={<Navigate to="/consents" replace />} />
      <Route path="/compliance/consent-library" element={<Navigate to="/consents" replace />} />
      <Route
        path="/compliance/surgical-consents"
        element={<Navigate to="/consents/surgical" replace />}
      />
    </Route>,
  ],
  navItems: [{ label: 'Ortho Consent', to: '/consents/ortho', icon: PenLine }],
}
