import { BarChart3 } from 'lucide-react'
import { Route } from 'react-router-dom'
import ReportDetailPage from '@/features/reports/pages/detail'
import ReportsPage from '@/features/reports/pages/index'
import MonthlySummariesPage, { MonthlyDetailPage } from '@/features/reports/pages/monthly'
import QuarterlySummariesPage, { QuarterlyDetailPage } from '@/features/reports/pages/quarterly'
import WeeklySummariesPage from '@/features/reports/pages/weekly'
import WeeklyDetailPage from '@/features/reports/pages/weekly-detail'
import { ReportsLayout } from '@/features/reports/reports-layout'
import { AdminRoute } from '@/shared/components/admin-route'
import type { Module } from './types'

export const reportsModule: Module = {
  id: 'reports',
  label: 'Clinic Reports',
  order: 12.0,
  permission: 'reports',
  disallowedRoles: ['doctor'],
  hasAccess: (can) => can('reports', 'create'),
  routes: [
    <Route key="reports-layout" element={<ReportsLayout />}>
      <Route path="/reports" element={<ReportsPage />} />
      <Route path="/reports/:id" element={<ReportDetailPage />} />
      {/* Period rollups are an admin management view — see reports-layout.tsx. */}
      <Route element={<AdminRoute />}>
        <Route path="/reports/weekly" element={<WeeklySummariesPage />} />
        <Route path="/reports/weekly/:weekStart" element={<WeeklyDetailPage />} />
        <Route path="/reports/monthly" element={<MonthlySummariesPage />} />
        <Route path="/reports/monthly/:monthStart" element={<MonthlyDetailPage />} />
        <Route path="/reports/quarterly" element={<QuarterlySummariesPage />} />
        <Route path="/reports/quarterly/:quarterStart" element={<QuarterlyDetailPage />} />
      </Route>
    </Route>,
  ],
  navItems: [
    {
      label: 'Clinic Reports',
      to: '/reports',
      icon: BarChart3,
    },
  ],
}
