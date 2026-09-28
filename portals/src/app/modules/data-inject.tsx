import { Route } from 'react-router-dom'
import AnalyticsConfigPage from '@/features/data-inject/pages/analytics'
import ClinicalConfigPage from '@/features/data-inject/pages/clinical'
import FinanceConfigPage from '@/features/data-inject/pages/finance'
import DataInjectPage from '@/features/data-inject/pages/index'
import PatientRecordsConfigPage from '@/features/data-inject/pages/patient-records'
import ReportsConfigPage from '@/features/data-inject/pages/reports-config'
import type { Module } from './types'

export const dataInjectModule: Module = {
  id: 'data_inject',
  label: 'Data Inject',
  order: 16.5,
  permission: 'data_inject',
  routes: [
    <Route key="data-inject" path="/data-inject" element={<DataInjectPage />} />,
    <Route
      key="data-inject-patient-records"
      path="/data-inject/patient-records"
      element={<PatientRecordsConfigPage />}
    />,
    <Route
      key="data-inject-clinical"
      path="/data-inject/clinical"
      element={<ClinicalConfigPage />}
    />,
    <Route key="data-inject-finance" path="/data-inject/finance" element={<FinanceConfigPage />} />,
    <Route
      key="data-inject-reports-config"
      path="/data-inject/reports-config"
      element={<ReportsConfigPage />}
    />,
    <Route
      key="data-inject-analytics"
      path="/data-inject/analytics"
      element={<AnalyticsConfigPage />}
    />,
  ],
  // No sidebar entry — Data Inject is reached via Settings → Data Inject (the
  // `data-inject-hub` section renders this module's DataInjectPage).
  navItems: [],
}
