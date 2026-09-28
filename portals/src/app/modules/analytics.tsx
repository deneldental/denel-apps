import { TrendingUp } from 'lucide-react'
import { Navigate, Route } from 'react-router-dom'
import { AnalyticsLayout } from '@/features/analytics/analytics-layout'
import ClinicalAnalyticsPage from '@/features/analytics/pages/clinical'
import ComplianceAnalyticsPage from '@/features/analytics/pages/compliance'
import CrmAnalyticsPage from '@/features/analytics/pages/crm'
import DataIntegrityPage from '@/features/analytics/pages/data-integrity'
import FinancialAnalyticsPage from '@/features/analytics/pages/financial'
import InsuranceAnalyticsPage from '@/features/analytics/pages/insurance'
import OperationalAnalyticsPage from '@/features/analytics/pages/operational'
import ExecutiveOverviewPage from '@/features/analytics/pages/overview'
import PatientAnalyticsPage from '@/features/analytics/pages/patient'
import SpecialistAnalyticsPage from '@/features/analytics/pages/specialist'
import StoreAnalyticsPage from '@/features/analytics/pages/store'
import WorkforceAnalyticsPage from '@/features/analytics/pages/workforce'
import { AdminRoute } from '@/shared/components/admin-route'
import type { Module } from './types'

export const analyticsModule: Module = {
  id: 'analytics',
  label: 'Analytics',
  order: 15,
  // Note: hasAccess is currently unreachable/redundant because adminOnly: true
  // filters out all non-admins first, and admins bypass the check anyway.
  hasAccess: (can) =>
    can('analytics', 'read') && (can('messaging', 'read') || can('inventory', 'update')),
  adminOnly: true,
  routes: [
    <Route key="analytics-admin" element={<AdminRoute />}>
      <Route element={<AnalyticsLayout />}>
        <Route path="/analytics" element={<Navigate to="/analytics/overview" replace />} />
        <Route path="/analytics/overview" element={<ExecutiveOverviewPage />} />
        <Route path="/analytics/financial" element={<FinancialAnalyticsPage />} />
        <Route path="/analytics/operational" element={<OperationalAnalyticsPage />} />
        <Route path="/analytics/patient" element={<PatientAnalyticsPage />} />
        <Route path="/analytics/workforce" element={<WorkforceAnalyticsPage />} />
        <Route path="/analytics/specialist" element={<SpecialistAnalyticsPage />} />
        <Route path="/analytics/clinical" element={<ClinicalAnalyticsPage />} />
        <Route path="/analytics/store" element={<StoreAnalyticsPage />} />
        <Route path="/analytics/crm" element={<CrmAnalyticsPage />} />
        <Route path="/analytics/insurance" element={<InsuranceAnalyticsPage />} />
        <Route path="/analytics/compliance" element={<ComplianceAnalyticsPage />} />
        <Route path="/analytics/data-integrity" element={<DataIntegrityPage />} />
      </Route>
    </Route>,
  ],
  navItems: [
    {
      label: 'Analytics',
      to: '/analytics/overview',
      icon: TrendingUp,
    },
  ],
}
