import { ClipboardCheck } from 'lucide-react'
import { Route } from 'react-router-dom'
import ComplianceDetailPage from '@/features/compliance/pages/detail'
import AllCompliancePage from '@/features/compliance/pages/index'
import { AdminRoute } from '@/shared/components/admin-route'
import type { Module } from './types'

export const complianceModule: Module = {
  id: 'compliance',
  label: 'Compliance',
  order: 13,
  // Note: hasAccess is currently unreachable/redundant because adminOnly: true
  // filters out all non-admins first, and admins bypass the check anyway.
  hasAccess: (can) =>
    can('compliance', 'read') && (can('messaging', 'read') || can('inventory', 'update')),
  adminOnly: true,
  routes: [
    <Route
      key="compliance"
      path="/compliance"
      element={
        <AdminRoute>
          <AllCompliancePage />
        </AdminRoute>
      }
    />,
    <Route
      key="compliance-detail"
      path="/compliance/:id"
      element={
        <AdminRoute>
          <ComplianceDetailPage />
        </AdminRoute>
      }
    />,
  ],
  navItems: [
    {
      label: 'Compliance',
      to: '/compliance',
      icon: ClipboardCheck,
    },
  ],
}
