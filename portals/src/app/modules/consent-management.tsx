import { Navigate, Route } from 'react-router-dom'
import { ConsentLayout } from '@/features/consent-management/consent-layout'
import AllConsentsPage from '@/features/consent-management/pages/index'
import ConsentOrthoPage from '@/features/consent-management/pages/ortho'
import ConsentPendingPage from '@/features/consent-management/pages/pending'
import ConsentSignPage from '@/features/consent-management/pages/sign'
import ConsentSurgicalPage from '@/features/consent-management/pages/surgical'
import ConsentTemplatesPage from '@/features/consent-management/pages/templates'
import OrthoConsentDetailPage from '@/features/ortho-consent/pages/detail'
import type { Module } from './types'

export const consentManagementModule: Module = {
  id: 'consent-management',
  label: 'Consents',
  order: 13.5,
  hasAccess: (can) => can('compliance', 'read') && !can('messaging', 'read'),
  routes: [
    <Route key="consent-layout" element={<ConsentLayout />}>
      <Route path="/consents" element={<AllConsentsPage />} />
      <Route path="/consents/pending" element={<ConsentPendingPage />} />
      <Route path="/consents/templates" element={<ConsentTemplatesPage />} />
      <Route path="/consents/ortho" element={<ConsentOrthoPage />} />
      <Route path="/consents/ortho/:patientId" element={<OrthoConsentDetailPage />} />
      <Route path="/consents/surgical" element={<ConsentSurgicalPage />} />
      <Route path="/consents/sign" element={<ConsentSignPage />} />
      {/* Legacy redirects */}
      <Route path="/ortho-consent" element={<Navigate to="/consents/ortho" replace />} />
      <Route
        path="/ortho-consent/:patientId"
        element={<Navigate to="/consents/ortho/:patientId" replace />}
      />
      <Route
        path="/compliance/consent-library"
        element={<Navigate to="/consents/templates" replace />}
      />
      <Route
        path="/compliance/surgical-consents"
        element={<Navigate to="/consents/surgical" replace />}
      />
    </Route>,
  ],
  navItems: [],
}
