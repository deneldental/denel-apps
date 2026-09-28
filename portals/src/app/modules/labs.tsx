import { FlaskConical } from 'lucide-react'
import { Navigate, Route } from 'react-router-dom'
import LabCaseDetailPage from '@/features/labs/pages/case-detail'
import LabsPage from '@/features/labs/pages/index'
import LabVendorDetailPage from '@/features/labs/pages/vendor-detail'
import type { Module } from './types'

export const labsModule: Module = {
  id: 'labs',
  label: 'Labs',
  order: 10.0,
  permission: 'labs',
  routes: [
    <Route key="labs" path="/labs" element={<LabsPage />} />,
    <Route key="labs-case-detail" path="/labs/cases/:id" element={<LabCaseDetailPage />} />,
    <Route key="labs-vendor-detail" path="/labs/vendors/:id" element={<LabVendorDetailPage />} />,
    <Route key="labs-jobs" path="/labs/jobs" element={<Navigate to="/labs" replace />} />,
    <Route key="labs-reports" path="/labs/reports" element={<Navigate to="/labs" replace />} />,
  ],
  navItems: [
    {
      label: 'Labs',
      to: '/labs',
      icon: FlaskConical,
    },
  ],
}
