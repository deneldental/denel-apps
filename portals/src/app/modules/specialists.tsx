import { UserCog } from 'lucide-react'
import { useEffect } from 'react'
import { Navigate, Route, useLocation } from 'react-router-dom'
import SpecialistDetailPage from '@/features/specialists/pages/detail'
import SpecialistsPage from '@/features/specialists/pages/index'
import type { Module } from './types'

/**
 * Specialists — clinical/billing provider records. Previously nested under the
 * HR module (`/hr/specialists`); re-homed here as a standalone module when the
 * HR-admin surface moved to the dedicated HR app. Specialists stays in portal
 * because invoices, payment-plans, and services depend on it.
 */

const HR_APP_ORIGIN = 'https://hr.deneldental.com'

/**
 * Redirects legacy in-portal HR URLs to the standalone HR app. `to` overrides
 * the target path; otherwise the `/hr` prefix is stripped (so `/hr/staff` →
 * `/staff` on the HR app).
 */
function ExternalHrRedirect({ to }: { to?: string }) {
  const { pathname, search } = useLocation()
  useEffect(() => {
    const target = to ?? (pathname.replace(/^\/hr/, '') || '/')
    window.location.replace(`${HR_APP_ORIGIN}${target}${to ? '' : search}`)
  }, [pathname, search, to])
  return null
}

export const specialistsModule: Module = {
  id: 'specialists',
  label: 'Specialists',
  order: 11.1, // next to Services (price catalog)
  permission: 'specialists',
  routes: [
    // Re-homed standalone specialist routes
    <Route key="specialists" path="/specialists" element={<SpecialistsPage />} />,
    <Route key="specialist-detail" path="/specialists/:id" element={<SpecialistDetailPage />} />,
    // Old HR-nested specialist URLs → re-homed standalone routes
    <Route
      key="hr-specialists-redirect"
      path="/hr/specialists"
      element={<Navigate to="/specialists" replace />}
    />,
    <Route
      key="hr-specialist-detail-redirect"
      path="/hr/specialists/:id"
      element={<HrSpecialistDetailRedirect />}
    />,
    // Everything else under /hr/* now lives in the standalone HR app
    <Route key="hr-root-redirect" path="/hr" element={<ExternalHrRedirect />} />,
    <Route key="hr-splat-redirect" path="/hr/*" element={<ExternalHrRedirect />} />,
    // Legacy staff aliases → HR app staff directory
    <Route key="staff-redirect" path="/staff" element={<ExternalHrRedirect to="/staff" />} />,
    <Route
      key="staff-id-redirect"
      path="/staff/:id"
      element={<ExternalHrRedirect to="/staff" />}
    />,
    <Route key="team-redirect" path="/team" element={<ExternalHrRedirect to="/staff" />} />,
    // Anviz device config moved to the HR app
    <Route
      key="anviz-redirect"
      path="/integrations/anviz"
      element={<ExternalHrRedirect to="/attendance-device" />}
    />,
  ],
  navItems: [
    {
      label: 'Specialists',
      to: '/specialists',
      icon: UserCog,
    },
  ],
}

function HrSpecialistDetailRedirect() {
  const { pathname } = useLocation()
  const id = pathname.split('/').pop()
  return <Navigate to={`/specialists/${id}`} replace />
}
